import { vi, describe, expect, it } from "vitest";
import {
  CompatibleApiError,
  type CompatibleTransaction,
  type ListingPage,
  type TransactionPage,
} from "@donut/compatible-api";
import {
  calculateStackPricing,
  createRawObservationEvidence,
  createTransactionFingerprint,
  normalizeItemVariant,
  type SourceItemForNormalization,
} from "@donut/domain";
import type { CollectorConfig } from "./config.js";
import { MarketCollector, type CompatibleApiPort } from "./ingestion.js";
import { CollectorMetrics } from "./metrics.js";
import { PriorityRateBudget } from "./rate-budget.js";
import type { CollectorStore } from "./types.js";

describe("MarketCollector transaction continuity scan", () => {
  it("persists exact evidence and a collision-aware logical transaction", async () => {
    const sourceId = "00000000-0000-4000-8000-000000000001";
    const sourceItem: SourceItemForNormalization = {
      id: "minecraft:diamond",
      count: 64n,
      displayName: null,
      lore: [],
      enchantments: {},
      trim: null,
      contents: null,
      fieldStates: {
        displayName: "present",
        lore: "present",
        enchantments: "present",
        trim: "present",
        contents: "present",
      },
      metadataCoverage: "complete",
    };
    const normalizedVariant = normalizeItemVariant(sourceItem);
    const stackPricing = calculateStackPricing("640", 64n);
    const fingerprint = createTransactionFingerprint({
      sourceId,
      itemVariantFingerprint: normalizedVariant.fingerprint,
      sellerUuid: "00000000-0000-4000-8000-000000000002",
      sellerName: "Seller",
      totalPrice: "640",
      quantity: 64n,
      soldAtUnixMs: 1_788_236_400_000n,
    });
    const value: CompatibleTransaction = {
      sourceItem,
      seller: { name: "Seller", uuid: "00000000-0000-4000-8000-000000000002" },
      totalPriceLexeme: "640",
      soldAtUnixMs: 1_788_236_400_000n,
      normalizedVariant,
      stackPricing,
      fingerprint,
      occurrenceOrdinal: 1,
      occurrenceKey: `${fingerprint.value}:1`,
      identicalOccurrenceCount: 1,
      collisionAmbiguous: false,
    };
    const rawBody = '{"status":200,"result":[{"price":640}]}';
    const evidence = createRawObservationEvidence({
      sourceId,
      providerVersion: "compatible-api/v1",
      collectorVersion: "collector/v1",
      endpoint: "/v1/auction/transactions/1",
      observedAt: "2026-09-01T12:00:01.000Z",
      httpStatus: 200,
      contentType: "application/json",
      rawBody,
      validationState: "valid",
      normalizationState: "normalized",
      confidence: "high",
    });
    const retryEvidence = createRawObservationEvidence({
      sourceId,
      providerVersion: "compatible-api/v1",
      collectorVersion: "collector/v1",
      endpoint: "/v1/auction/transactions/1",
      observedAt: "2026-09-01T12:00:00.000Z",
      httpStatus: 429,
      contentType: "application/json",
      rawBody: '{"status":429,"message":"slow down"}',
      validationState: "invalid",
      normalizationState: "not_attempted",
      confidence: "high",
    });
    const page: TransactionPage = {
      kind: "transactions",
      page: 1,
      httpBodyStatus: 200,
      records: [{ index: 0, state: "valid", value, raw: { price: { kind: "lossless-json-number", lexeme: "640" } }, issues: [] }],
      issues: [],
      validCount: 1,
      partialCount: 0,
      invalidCount: 0,
    };
    const api: CompatibleApiPort = {
      getTransactionPage: vi.fn().mockImplementation(async (
        _page: number,
        options?: Parameters<CompatibleApiPort["getTransactionPage"]>[1],
      ) => {
        await options?.onRetry?.({
          failedAttempt: 1,
          nextAttempt: 2,
          delayMs: 0,
          error: new CompatibleApiError({
            code: "rate_limited",
            message: "Compatible API returned HTTP 429",
            retryable: true,
            httpStatus: 429,
            evidence: retryEvidence,
          }),
        });
        return {
          page: 1,
          endpoint: evidence.endpoint,
          data: page,
          evidence,
          attempts: 2,
          latencyMs: 25,
        };
      }),
      getListingPage: vi.fn(),
    };
    const persisted = vi.fn().mockResolvedValue({
      observationId: "1",
      logicalTransactionId: "00000000-0000-4000-8000-000000000010",
      isNewLogicalTransaction: true,
    });
    const store = fakeStore(persisted);
    const metrics = new CollectorMetrics();
    const collector = new MarketCollector(
      api,
      store,
      sourceId,
      testConfig(),
      new PriorityRateBudget({ requestsPerMinute: 10, transactionReservePercent: 60 }),
      metrics,
    );

    const outcome = await collector.scanTransactions();

    expect(outcome.status).toBe("succeeded");
    expect(outcome.counts).toMatchObject({ received: 1, added: 1, duplicates: 0, invalid: 0 });
    expect(store.appendFetchEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ sha256: evidence.contentSha256 }),
      expect.objectContaining({ httpStatus: 200, page: 1, attempt: 2 }),
    );
    expect(store.appendFetchEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ sha256: retryEvidence.contentSha256 }),
      expect.objectContaining({ httpStatus: 429, page: 1, attempt: 1, errorCode: "rate_limited" }),
    );
    expect(outcome.counts).toMatchObject({ requests: 2, responses: 2 });
    expect(metrics.snapshot()).toMatchObject({ requests: 2, responses: 2, throttles: 1 });
    expect(persisted).toHaveBeenCalledWith(expect.objectContaining({
      totalPrice: "640",
      unitPrice: "10.000000000000000000",
      unitPriceExactText: "10",
      unitPriceNumerator: "10",
      unitPriceDenominator: "1",
      occurrenceOrdinal: 1,
      dedupeVersion: "transaction-fingerprint/v1",
    }));
    expect(store.finalizeCollectionRun).toHaveBeenCalledWith(
      expect.objectContaining({
        completion: expect.objectContaining({ status: "succeeded", newCount: 1 }),
      }),
    );
  });

  it("does not publish an empty partial ask snapshot when shutdown interrupts a scan", async () => {
    const sourceId = "00000000-0000-4000-8000-000000000001";
    const controller = new AbortController();
    const page: ListingPage = {
      kind: "listings",
      page: 1,
      httpBodyStatus: 200,
      records: [],
      nullPaddingCount: 0,
      nullPaddingPositions: [],
      resultPositionCount: 1,
      issues: [],
      validCount: 0,
      partialCount: 0,
      invalidCount: 0,
    };
    const evidence = createRawObservationEvidence({
      sourceId,
      providerVersion: "compatible-api/v1",
      collectorVersion: "collector/v1",
      endpoint: "/v1/auction/list/1",
      observedAt: "2026-09-01T12:00:01.000Z",
      httpStatus: 200,
      contentType: "application/json",
      rawBody: '{"status":200,"result":[]}',
      validationState: "valid",
      normalizationState: "normalized",
      confidence: "high",
    });
    const api: CompatibleApiPort = {
      getTransactionPage: vi.fn(),
      getListingPage: vi.fn().mockImplementation(async () => {
        controller.abort(new Error("test shutdown"));
        return {
          page: 1,
          endpoint: evidence.endpoint,
          data: page,
          evidence,
          attempts: 1,
          latencyMs: 10,
        };
      }),
    };
    const store = fakeStore(vi.fn());
    const collector = new MarketCollector(
      api,
      store,
      sourceId,
      { ...testConfig(), listingEnabled: true },
      new PriorityRateBudget({ requestsPerMinute: 10, transactionReservePercent: 60 }),
      new CollectorMetrics(),
    );

    const outcome = await collector.scanListings(controller.signal);

    expect(outcome.status).toBe("cancelled");
    expect(store.persistListingSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
      [],
    );
    expect(store.finalizeCollectionRun).toHaveBeenCalledWith(expect.objectContaining({
      completion: expect.objectContaining({ status: "cancelled" }),
    }));
  });
});

function testConfig(): CollectorConfig {
  return {
    databaseUrl: "postgresql://redacted.invalid/market",
    apiBaseUrl: "https://mirror.example.test",
    apiBearerToken: "fake-test-token",
    sourceKey: "test-source",
    sourceDisplayName: "Test source",
    instanceId: "test-instance",
    mode: "one_shot",
    transactionPages: 1,
    transactionPollMs: 15_000,
    listingEnabled: false,
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

function fakeStore(persisted: ReturnType<typeof vi.fn>): CollectorStore {
  return {
    ping: vi.fn().mockResolvedValue(true),
    close: vi.fn().mockResolvedValue(undefined),
    upsertSource: vi.fn().mockResolvedValue("source"),
    startCollectionRun: vi.fn().mockResolvedValue(undefined),
    completeCollectionRun: vi.fn().mockResolvedValue(undefined),
    markAbandonedRunsPartial: vi.fn().mockResolvedValue(0),
    appendFetchEvidence: vi.fn().mockResolvedValue(undefined),
    upsertCanonicalItem: vi.fn().mockResolvedValue("00000000-0000-4000-8000-000000000003"),
    upsertItemVariant: vi.fn().mockResolvedValue("00000000-0000-4000-8000-000000000004"),
    upsertSeller: vi.fn().mockResolvedValue("00000000-0000-4000-8000-000000000005"),
    persistTransactionObservation: persisted,
    persistListingSnapshot: vi.fn().mockResolvedValue([]),
    appendQuarantinedRecord: vi.fn().mockResolvedValue(undefined),
    appendHealthSample: vi.fn().mockResolvedValue(undefined),
    recordGap: vi.fn().mockResolvedValue(undefined),
    acquireLease: vi.fn().mockResolvedValue(null),
    renewLease: vi.fn().mockResolvedValue(null),
    releaseLease: vi.fn().mockResolvedValue(true),
    withAdvisoryLock: async <T>(_key: string, operation: (signal: AbortSignal) => Promise<T>) => ({
      acquired: true as const,
      value: await operation(new AbortController().signal),
    }),
    readCheckpoint: vi.fn().mockResolvedValue(null),
    finalizeCollectionRun: vi.fn().mockResolvedValue(undefined),
    saveCheckpoint: vi.fn().mockResolvedValue(undefined),
  };
}
