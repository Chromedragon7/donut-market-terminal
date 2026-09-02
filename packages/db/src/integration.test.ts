import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { runMigrations } from "./migrations.js";
import { createDatabasePool } from "./pool.js";
import { MarketRepository } from "./repository.js";

const enabled = process.env.DONUT_DB_INTEGRATION === "1";
const connectionString = process.env.DATABASE_URL;

describe.skipIf(!enabled || connectionString === undefined)("PostgreSQL integration", () => {
  const pool = createDatabasePool({
    connectionString: connectionString ?? "",
    applicationName: "donut-db-integration",
    maxConnections: 2,
  });
  const repository = new MarketRepository(pool);

  afterAll(async () => {
    await pool.end();
  });

  it("applies migrations idempotently and supports a fenced lease", async () => {
    const first = await runMigrations(pool);
    const second = await runMigrations(pool);
    expect(first.applied.length + first.alreadyApplied.length).toBeGreaterThan(0);
    expect(second.applied).toEqual([]);

    const ownerId = randomUUID();
    const lease = await repository.acquireLease(`integration-${randomUUID()}`, ownerId, 10_000);
    expect(lease?.ownerId).toBe(ownerId);
    expect(lease === null ? false : await repository.releaseLease(lease)).toBe(true);

    const now = new Date();
    const aggregates = await repository.refreshMarketAggregates({
      sourceId: randomUUID(),
      from: new Date(now.valueOf() - 60_000),
      to: now,
      computationVersion: "integration/v1",
      dedupeVersion: "transaction-fingerprint/v1",
      computedAt: now,
    });
    expect(aggregates).toEqual({ saleCandles: 0, askCandles: 0, summaries: 0 });
  });
});
