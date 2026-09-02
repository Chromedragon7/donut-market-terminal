import { describe, expect, it, vi } from "vitest";
import type { Lease } from "@donut/db";
import type { CollectorConfig } from "./config.js";
import type { MarketCollector } from "./ingestion.js";
import { CollectorScheduler } from "./scheduler.js";
import { newRunCounts, type CollectorStore, type RunOutcome } from "./types.js";

describe("CollectorScheduler", () => {
  it("recovers abandoned work under the lease and runs transaction continuity first", async () => {
    const calls: string[] = [];
    const collector = {
      scanTransactions: vi.fn(async (signal?: AbortSignal) => {
        calls.push(`transactions:${String(signal?.aborted)}`);
        return outcome("transactions", "succeeded");
      }),
      scanListings: vi.fn(async () => {
        calls.push("listings");
        return outcome("listings", "succeeded");
      }),
    } as unknown as MarketCollector;
    const lease = testLease();
    const store = {
      withAdvisoryLock: successfulAdvisoryLock(),
      acquireLease: vi.fn().mockResolvedValue(lease),
      renewLease: vi.fn().mockResolvedValue(lease),
      markAbandonedRunsPartial: vi.fn(async () => {
        calls.push("recovery");
        return 1;
      }),
      releaseLease: vi.fn().mockResolvedValue(true),
    } as unknown as CollectorStore;

    await new CollectorScheduler(collector, store, SOURCE_ID, testConfig()).run();

    expect(calls).toEqual(["recovery", "transactions:false", "listings"]);
    expect(store.releaseLease).toHaveBeenCalledWith(lease);
  });

  it("does not spend listing capacity when the continuity scan completely fails", async () => {
    const collector = {
      scanTransactions: vi.fn().mockResolvedValue(outcome("transactions", "failed")),
      scanListings: vi.fn().mockResolvedValue(outcome("listings", "succeeded")),
    } as unknown as MarketCollector;
    const lease = testLease();
    const store = {
      withAdvisoryLock: successfulAdvisoryLock(),
      acquireLease: vi.fn().mockResolvedValue(lease),
      renewLease: vi.fn().mockResolvedValue(lease),
      markAbandonedRunsPartial: vi.fn().mockResolvedValue(0),
      releaseLease: vi.fn().mockResolvedValue(true),
    } as unknown as CollectorStore;

    await expect(
      new CollectorScheduler(collector, store, SOURCE_ID, testConfig()).run(),
    ).rejects.toThrow("transactions=failed");

    expect(collector.scanTransactions).toHaveBeenCalledOnce();
    expect(collector.scanListings).not.toHaveBeenCalled();
    expect(store.releaseLease).toHaveBeenCalledOnce();
  });

  it("does not start a collection run when another healthy leader owns the lease", async () => {
    const collector = {
      scanTransactions: vi.fn(),
      scanListings: vi.fn(),
    } as unknown as MarketCollector;
    const store = {
      withAdvisoryLock: successfulAdvisoryLock(),
      acquireLease: vi.fn().mockResolvedValue(null),
    } as unknown as CollectorStore;

    await new CollectorScheduler(collector, store, SOURCE_ID, testConfig()).run();

    expect(collector.scanTransactions).not.toHaveBeenCalled();
    expect(collector.scanListings).not.toHaveBeenCalled();
  });

  it("does not touch the lease when another process holds the advisory lock", async () => {
    const collector = {
      scanTransactions: vi.fn(),
      scanListings: vi.fn(),
    } as unknown as MarketCollector;
    const store = {
      withAdvisoryLock: vi.fn().mockResolvedValue({ acquired: false }),
      acquireLease: vi.fn(),
    } as unknown as CollectorStore;

    await new CollectorScheduler(collector, store, SOURCE_ID, testConfig()).run();

    expect(store.acquireLease).not.toHaveBeenCalled();
    expect(collector.scanTransactions).not.toHaveBeenCalled();
  });
});

const SOURCE_ID = "00000000-0000-4000-8000-000000000001";

function testLease(): Lease {
  const acquiredAt = new Date("2026-09-01T12:00:00.000Z");
  return {
    key: `collector:${SOURCE_ID}:scheduler`,
    ownerId: "test-instance",
    fencingToken: "1",
    acquiredAt,
    expiresAt: new Date(acquiredAt.valueOf() + 60_000),
  };
}

function successfulAdvisoryLock() {
  return vi.fn(async <T>(_key: string, operation: (signal: AbortSignal) => Promise<T>) => ({
    acquired: true as const,
    value: await operation(new AbortController().signal),
  }));
}

function outcome(
  resource: RunOutcome["resource"],
  status: RunOutcome["status"],
): RunOutcome {
  const startedAt = new Date("2026-09-01T12:00:00.000Z");
  return {
    resource,
    runId: "00000000-0000-4000-8000-000000000010",
    status,
    counts: newRunCounts(),
    startedAt,
    completedAt: new Date(startedAt.valueOf() + 100),
  };
}

function testConfig(): CollectorConfig {
  return {
    databaseUrl: "postgresql://redacted.invalid/market",
    apiBaseUrl: "https://mirror.example.test",
    apiBearerToken: "fake-test-token",
    sourceKey: "test-source",
    sourceDisplayName: "Test source",
    instanceId: "test-instance",
    mode: "one_shot",
    transactionPages: 10,
    transactionPollMs: 15_000,
    listingEnabled: true,
    listingMaxPages: 2,
    listingScanBudgetMs: 5_000,
    listingPollMs: 60_000,
    requestsPerMinute: 10,
    transactionReservePercent: 60,
    maxRunBackoffMs: 60_000,
    healthPort: 3_001,
    leaseTtlMs: 60_000,
    shutdownGraceMs: 20_000,
    collectorVersion: "collector/v1",
    providerVersion: "compatible-api/v1",
    validationVersion: "compatible-validation/v1",
    normalizationVersion: "item-variant/v1",
    dedupeVersion: "transaction-fingerprint/v1",
    aggregationVersion: "market-aggregate/v1",
    scheduleVersion: "priority-schedule/v1",
  };
}
