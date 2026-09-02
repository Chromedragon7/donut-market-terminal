import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { MarketRepository } from "./repository.js";

describe("MarketRepository", () => {
  it("rejects raw evidence when the supplied content hash is wrong", async () => {
    const query = vi.fn();
    const repository = new MarketRepository({ query } as unknown as Pool);

    await expect(
      repository.appendRawPayload({
        sha256: "0".repeat(64),
        bytes: new TextEncoder().encode("evidence"),
        firstObservedAt: new Date("2026-09-01T00:00:00Z"),
      }),
    ).rejects.toThrow("does not match");
    expect(query).not.toHaveBeenCalled();
  });

  it("inserts verified raw bytes with parameters instead of SQL interpolation", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const repository = new MarketRepository({ query } as unknown as Pool);
    const bytes = new TextEncoder().encode('{"token":"not-a-real-secret"}');
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    await repository.appendRawPayload({
      sha256,
      bytes,
      contentType: "application/json",
      firstObservedAt: new Date("2026-09-01T00:00:00Z"),
    });

    expect(query).toHaveBeenCalledOnce();
    const [sql, parameters] = query.mock.calls[0] as [string, readonly unknown[]];
    expect(sql).toContain("VALUES ($1, $2, $3, $4, $5, $6)");
    expect(sql).not.toContain("not-a-real-secret");
    expect(parameters[0]).toBe(sha256);
    expect(parameters[1]).toBeInstanceOf(Buffer);
  });

  it("always releases an acquired advisory lock when the operation fails", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 });
    const release = vi.fn();
    const once = vi.fn();
    const off = vi.fn();
    const client = { query, release, once, off } as unknown as PoolClient;
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
    const repository = new MarketRepository(pool);

    await expect(
      repository.withAdvisoryLock("collector", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(query).toHaveBeenCalledTimes(2);
    expect(String(query.mock.calls[1]?.[0])).toContain("pg_advisory_unlock");
    expect(once).toHaveBeenCalledWith("error", expect.any(Function));
    expect(off).toHaveBeenCalledWith("error", expect.any(Function));
    expect(release).toHaveBeenCalledOnce();
  });

  it("releases a checked-out client when BEGIN itself fails", async () => {
    const query = vi.fn().mockRejectedValue(new Error("database unavailable"));
    const release = vi.fn();
    const client = { query, release } as unknown as PoolClient;
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
    const repository = new MarketRepository(pool);

    await expect(repository.withTransaction(async () => undefined)).rejects.toThrow(
      "database unavailable",
    );

    expect(query).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it("preserves the last successful checkpoint when a later run is partial", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const repository = new MarketRepository({ query } as unknown as Pool);

    await repository.saveCheckpoint(
      "00000000-0000-4000-8000-000000000001",
      "auction_transactions",
      "collector-checkpoint/v1",
      { pagesCompleted: [1] },
      null,
      null,
    );

    const [sql] = query.mock.calls[0] as [string, readonly unknown[]];
    expect(sql).toContain("WHEN EXCLUDED.last_success_at IS NULL");
    expect(sql).toContain("COALESCE(EXCLUDED.last_success_at, collector_checkpoints.last_success_at)");
  });

  it("rolls back the snapshot when any listing observation fails", async () => {
    const statements: string[] = [];
    const query = vi.fn(async (sql: string) => {
      statements.push(sql);
      if (sql.includes("INSERT INTO listing_observations")) {
        throw new Error("observation write failed");
      }
      return { rows: [], rowCount: 1 };
    });
    const release = vi.fn();
    const client = { query, release } as unknown as PoolClient;
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
    const repository = new MarketRepository(pool);

    await expect(repository.persistListingSnapshot({
      id: "00000000-0000-4000-8000-000000000010",
      runId: "00000000-0000-4000-8000-000000000011",
      sourceId: "00000000-0000-4000-8000-000000000001",
      observedAt: new Date("2026-09-01T00:00:00.000Z"),
      completedAt: new Date("2026-09-01T00:00:01.000Z"),
      status: "complete",
      firstPage: 1,
      lastPage: 1,
      positionsObserved: 1,
      nonnullListings: 1,
      consistency: "unknown",
      fingerprintVersion: "listing-probabilistic-fingerprint/v1",
    }, [{
      requestId: "00000000-0000-4000-8000-000000000012",
      snapshotId: "00000000-0000-4000-8000-000000000010",
      runId: "00000000-0000-4000-8000-000000000011",
      sourceId: "00000000-0000-4000-8000-000000000001",
      recordIndex: 0,
      page: 1,
      pagePosition: 0,
      observedAt: new Date("2026-09-01T00:00:00.000Z"),
      canonicalItemId: "00000000-0000-4000-8000-000000000020",
      itemVariantId: "00000000-0000-4000-8000-000000000021",
      quantity: 1,
      totalAskPrice: "10",
      totalAskPriceSourceText: "10",
      unitAskPrice: "10",
      unitAskPriceExactText: "10",
      unitAskPriceNumerator: "10",
      unitAskPriceDenominator: "1",
      fingerprint: "a".repeat(64),
      fingerprintVersion: "listing-probabilistic-fingerprint/v1",
      confidence: "high",
    }])).rejects.toThrow("observation write failed");

    expect(statements[0]).toBe("BEGIN");
    expect(statements.some((sql) => sql.includes("INSERT INTO listing_snapshots"))).toBe(true);
    expect(statements.at(-1)).toBe("ROLLBACK");
    expect(statements).not.toContain("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });

  it("rejects unsafe lease durations before querying", async () => {
    const query = vi.fn();
    const repository = new MarketRepository({ query } as unknown as Pool);

    await expect(repository.acquireLease("scan", "worker", 0)).rejects.toThrow("positive safe integer");
    expect(query).not.toHaveBeenCalled();
  });

  it("validates outbox cursors before querying", async () => {
    const query = vi.fn();
    const repository = new MarketRepository({ query } as unknown as Pool);
    await expect(repository.readOutbox("1; DROP TABLE", 10, ["owner"])).rejects.toThrow(
      "unsigned integer string",
    );
    expect(query).not.toHaveBeenCalled();
  });

  it("reads the durable outbox with bounded parameterized pagination", async () => {
    const occurredAt = new Date("2026-09-01T00:00:00Z");
    const query = vi.fn().mockResolvedValue({
      rows: [{
        sequence_id: "42",
        event_id: "00000000-0000-4000-8000-000000000001",
        aggregate_type: "logical_transaction",
        aggregate_id: "00000000-0000-4000-8000-000000000002",
        event_type: "market.transaction.recorded",
        audience: "authenticated",
        payload: { sellerIncluded: false },
        occurred_at: occurredAt,
      }],
      rowCount: 1,
    });
    const repository = new MarketRepository({ query } as unknown as Pool);

    const events = await repository.readOutbox("41", 25, ["owner", "authenticated"]);

    expect(events[0]).toMatchObject({ cursor: "42", audience: "authenticated" });
    const [sql, parameters] = query.mock.calls[0] as [string, readonly unknown[]];
    expect(sql).toContain("sequence_id > $1::bigint");
    expect(parameters).toEqual(["41", ["owner", "authenticated"], 25]);
  });
});
