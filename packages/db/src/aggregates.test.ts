import { describe, expect, it, vi } from "vitest";
import type { Queryable } from "./types.js";
import { refreshMarketAggregates } from "./aggregates.js";

describe("refreshMarketAggregates", () => {
  it("idempotently refreshes exact sale/ask candles and current summaries", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const result = await refreshMarketAggregates({ query } as unknown as Queryable, {
      sourceId: "00000000-0000-4000-8000-000000000001",
      from: new Date("2026-09-01T00:00:00.000Z"),
      to: new Date("2026-09-01T01:00:00.000Z"),
      computationVersion: "market-aggregate/v1",
      dedupeVersion: "transaction-fingerprint/v1",
      computedAt: new Date("2026-09-01T01:00:00.000Z"),
    });

    expect(result).toEqual({ saleCandles: 5, askCandles: 5, summaries: 1 });
    expect(query).toHaveBeenCalledTimes(13);
    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements[0]).toContain("pg_advisory_xact_lock");
    const saleStatements = statements.filter((sql) => sql.includes("'completed_sale'"));
    const askStatements = statements.filter((sql) => sql.includes("'active_ask'"));
    expect(saleStatements).toHaveLength(5);
    expect(askStatements).toHaveLength(5);
    for (const sql of [...saleStatements, ...askStatements]) {
      expect(sql).toContain("ON CONFLICT");
      expect(sql).toContain("computation_version");
      expect(sql).not.toMatch(/double precision|::float|\breal\b/i);
    }
    expect(saleStatements[0]).toContain("sum(total_price) / NULLIF(sum(quantity), 0)");
    expect(saleStatements[0]).toContain("logical.dedupe_version = $6");
    expect(saleStatements[0]).toContain("identity_state <> 'excluded'");
    expect(askStatements[0]).toContain("snapshot_points");
    expect(askStatements[0]).toContain("sum(observation.total_ask_price) / NULLIF(sum(observation.quantity), 0)");
    expect(askStatements[0]).toContain("identity_state <> 'excluded'");
    expect(statements.at(-2)).toContain("DELETE FROM market_summaries");
    expect(statements.at(-1)).toContain("recordedVolumeOnly");
    expect(statements.at(-1)).toContain("data_gaps");
  });

  it("rejects an invalid range before issuing SQL", async () => {
    const query = vi.fn();
    await expect(refreshMarketAggregates({ query } as unknown as Queryable, {
      sourceId: "source",
      from: new Date("2026-09-02T00:00:00.000Z"),
      to: new Date("2026-09-01T00:00:00.000Z"),
      computationVersion: "market-aggregate/v1",
      dedupeVersion: "transaction-fingerprint/v1",
      computedAt: new Date("2026-09-01T00:00:00.000Z"),
    })).rejects.toThrow("end must be after");
    expect(query).not.toHaveBeenCalled();
  });
});
