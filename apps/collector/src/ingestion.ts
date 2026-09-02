import { randomUUID } from "node:crypto";
import {
  CompatibleApiError,
  asCompatibleApiError,
  type AuctionListRequest,
  type CompatibleListing,
  type CompatiblePageResult,
  type CompatibleTransaction,
  type ListingPage,
  type RetryEvent,
  type TransactionPage,
  type ValidatedRecord,
} from "@donut/compatible-api";
import type {
  CollectionRunCompletion,
  GapInput,
  JsonObject,
  JsonValue,
  ListingObservationInput,
} from "@donut/db";
import type { CollectorConfig } from "./config.js";
import { mapWithConcurrency } from "./concurrency.js";
import { detectTransactionWindowGap } from "./continuity.js";
import { reconcileTransactionPageOccurrences } from "./dedupe.js";
import { persistErrorEvidence, persistPageEvidence, type PersistedPage } from "./evidence.js";
import { CollectorMetrics } from "./metrics.js";
import { listingObservation, transactionObservation } from "./normalization.js";
import { PriorityRateBudget } from "./rate-budget.js";
import { safeError } from "./redaction.js";
import { newRunCounts, type CollectorStore, type RunCounts, type RunOutcome } from "./types.js";

// The production pool has eight connections; leave one for the leader lock and
// one for health/coordination while normalizing and persisting page records.
const WRITE_CONCURRENCY = 6;

export interface CompatibleApiPort {
  getTransactionPage(
    page: number,
    options?: { readonly signal?: AbortSignal; readonly onRetry?: (event: RetryEvent) => void | Promise<void> },
  ): Promise<CompatiblePageResult<TransactionPage>>;
  getListingPage(
    page: number,
    request?: AuctionListRequest,
    options?: { readonly signal?: AbortSignal; readonly onRetry?: (event: RetryEvent) => void | Promise<void> },
  ): Promise<CompatiblePageResult<ListingPage>>;
}

interface StoredTransactionPage extends PersistedPage<TransactionPage> {
  readonly page: number;
}

interface StoredListingPage extends PersistedPage<ListingPage> {
  readonly page: number;
}

export interface MarketCollectorCallbacks {
  readonly onAuthorization?: (authorized: boolean | null) => void;
}

export class MarketCollector {
  public constructor(
    private readonly api: CompatibleApiPort,
    private readonly store: CollectorStore,
    private readonly sourceId: string,
    private readonly config: CollectorConfig,
    private readonly budget: PriorityRateBudget,
    private readonly metrics: CollectorMetrics,
    private readonly callbacks: MarketCollectorCallbacks = {},
  ) {}

  public async scanTransactions(signal?: AbortSignal): Promise<RunOutcome> {
    const startedAt = new Date();
    const runId = randomUUID();
    const counts = newRunCounts();
    const previousCheckpoint = await this.store.readCheckpoint(
      this.sourceId,
      "auction_transactions",
    );
    await this.startRun(runId, "auction_transactions", startedAt);
    const pages: StoredTransactionPage[] = [];
    let cancelled = false;

    for (let page = 1; page <= this.config.transactionPages; page += 1) {
      if (signal?.aborted === true) {
        cancelled = true;
        break;
      }
      const requestedAt = new Date();
      let finalAttempt = 1;
      let providerCompleted = false;
      try {
        await this.budget.acquire("transaction", signal);
        const result = await this.api.getTransactionPage(
          page,
          {
            ...(signal === undefined ? {} : { signal }),
            onRetry: async (event) => {
              finalAttempt = event.nextAttempt;
              await this.persistRetryEvidence(runId, "auction_transactions", page, event, requestedAt, counts);
            },
          },
        );
        providerCompleted = true;
        counts.requests += Math.max(1, result.attempts);
        this.metrics.recordRequest(Math.max(1, result.attempts));
        counts.responses += 1;
        counts.latenciesMs.push(result.latencyMs);
        this.metrics.recordResponse(result.latencyMs);
        const completeness = pageCompleteness(result.data);
        const persisted = await persistPageEvidence(
          this.store,
          this.evidenceContext(runId, "auction_transactions", page),
          result,
          completeness,
        );
        pages.push({ ...persisted, page });
        this.callbacks.onAuthorization?.(true);
      } catch (caught) {
        if (providerCompleted) {
          this.metrics.recordFailure("database");
          throw caught;
        }
        const error = asCompatibleApiError(caught, [this.config.apiBearerToken]);
        counts.requests += finalAttempt;
        await this.persistPageFailure(
          runId,
          "auction_transactions",
          page,
          error,
          requestedAt,
          counts,
          finalAttempt,
        );
        if (error.code === "aborted") {
          cancelled = true;
          break;
        }
        if (error.code === "unauthorized" || error.code === "forbidden") {
          this.callbacks.onAuthorization?.(false);
          break;
        }
      }
    }

    if (signal?.aborted === true) cancelled = true;

    if (!cancelled) {
      for (const page of pages) {
        await this.quarantineInvalidRecords(
          runId,
          "auction_transactions",
          page,
          page.result.data.records,
          counts,
        );
      }
    }

    const validRecords = cancelled ? [] : pages.flatMap((page) => page.result.data.records
      .filter((record): record is ValidatedRecord<CompatibleTransaction> & { readonly value: CompatibleTransaction } =>
        record.value !== null && record.state !== "invalid")
      .map((record) => ({ page, record })));
    const occurrences = reconcileTransactionPageOccurrences(validRecords.map(({ page, record }) => ({
      record: { page, record },
      page: page.page,
      fingerprint: record.value.fingerprint.value,
      occurrenceOrdinal: record.value.occurrenceOrdinal,
      collisionAmbiguous: record.value.collisionAmbiguous,
    })));

    let oldestSoldAt: bigint | null = null;
    let newestSoldAt: bigint | null = null;
    for (const occurrence of occurrences) {
      const { record } = occurrence.record;
      oldestSoldAt = oldestSoldAt === null || record.value.soldAtUnixMs < oldestSoldAt
        ? record.value.soldAtUnixMs
        : oldestSoldAt;
      newestSoldAt = newestSoldAt === null || record.value.soldAtUnixMs > newestSoldAt
        ? record.value.soldAtUnixMs
        : newestSoldAt;
    }

    await mapWithConcurrency(occurrences, WRITE_CONCURRENCY, async (occurrence) => {
      const { page, record } = occurrence.record;
      counts.received += 1;
      try {
        const observation = await transactionObservation(
          {
            store: this.store,
            sourceId: this.sourceId,
            runId,
            requestId: page.requestId,
            observedAt: page.observedAt,
            page: page.page,
            recordIndex: record.index,
            normalizationVersion: this.config.normalizationVersion,
            dedupeVersion: this.config.dedupeVersion,
          },
          record.value,
          occurrence.occurrenceOrdinal,
          occurrence.collisionAmbiguous,
          record.raw,
          record.state === "partial",
        );
        const persisted = await this.store.persistTransactionObservation(observation);
        if (persisted.isNewLogicalTransaction) counts.added += 1;
        else counts.duplicates += 1;
      } catch (error) {
        if (!isRecordNormalizationFailure(error)) {
          this.metrics.recordFailure("database");
          throw error;
        }
        counts.invalid += 1;
        await this.quarantineNormalizationError(
          runId,
          "auction_transactions",
          page,
          record,
          error,
        );
      }
    });

    const completedAt = new Date();
    const status = finalStatus(cancelled, pages.length, counts);
    const continuityGap = status === "succeeded"
      && this.config.transactionPages === 10
      && pages.length === 10
      && oldestSoldAt !== null
      ? detectTransactionWindowGap(
          previousCheckpoint?.cursor.newestSourceTimestampMs,
          previousCheckpoint?.lastSuccessAt ?? null,
          oldestSoldAt,
          this.sourceId,
          runId,
          completedAt,
        )
      : undefined;
    await this.finishRun(runId, "transactions", status, startedAt, completedAt, counts, {
      ...(oldestSoldAt === null ? {} : { oldestSourceTimestampMs: oldestSoldAt.toString() }),
      ...(newestSoldAt === null ? {} : { newestSourceTimestampMs: newestSoldAt.toString() }),
      pagesCompleted: pages.map((page) => page.page),
    }, continuityGap === undefined ? [] : [continuityGap]);
    return { resource: "transactions", runId, status, counts, startedAt, completedAt };
  }

  public async scanListings(signal?: AbortSignal): Promise<RunOutcome> {
    const startedAt = new Date();
    const runId = randomUUID();
    const counts = newRunCounts();
    await this.startRun(runId, "auction_listings", startedAt);
    const pages: StoredListingPage[] = [];
    let cancelled = false;
    let terminalPageObserved = false;

    for (let page = 1; page <= this.config.listingMaxPages; page += 1) {
      if (signal?.aborted === true) {
        cancelled = true;
        break;
      }
      const requestedAt = new Date();
      let finalAttempt = 1;
      let providerCompleted = false;
      try {
        await this.budget.acquire("listing", signal);
        const result = await this.api.getListingPage(
          page,
          {},
          {
            ...(signal === undefined ? {} : { signal }),
            onRetry: async (event) => {
              finalAttempt = event.nextAttempt;
              await this.persistRetryEvidence(runId, "auction_listings", page, event, requestedAt, counts);
            },
          },
        );
        providerCompleted = true;
        counts.requests += Math.max(1, result.attempts);
        this.metrics.recordRequest(Math.max(1, result.attempts));
        counts.responses += 1;
        counts.latenciesMs.push(result.latencyMs);
        this.metrics.recordResponse(result.latencyMs);
        const persisted = await persistPageEvidence(
          this.store,
          this.evidenceContext(runId, "auction_listings", page),
          result,
          pageCompleteness(result.data),
        );
        pages.push({ ...persisted, page });
        this.callbacks.onAuthorization?.(true);
        if (result.data.nullPaddingCount > 0 || result.data.resultPositionCount === 0) {
          terminalPageObserved = true;
          break;
        }
        if (Date.now() - startedAt.valueOf() >= this.config.listingScanBudgetMs) break;
      } catch (caught) {
        if (providerCompleted) {
          this.metrics.recordFailure("database");
          throw caught;
        }
        const error = asCompatibleApiError(caught, [this.config.apiBearerToken]);
        counts.requests += finalAttempt;
        this.metrics.recordRequest(finalAttempt);
        await persistErrorEvidence(
          this.store,
          this.evidenceContext(runId, "auction_listings", page),
          error,
          finalAttempt,
          requestedAt,
        );
        if (error.code === "invalid_page" && page > 1) {
          if (error.evidence !== undefined) {
            counts.responses += 1;
            this.metrics.recordResponse(responseLatency(error, requestedAt));
          }
          terminalPageObserved = true;
          break;
        }
        if (error.evidence !== undefined) {
          counts.responses += 1;
          this.metrics.recordResponse(responseLatency(error, requestedAt));
        }
        this.recordError(error, counts);
        if (error.code === "aborted") {
          cancelled = true;
          break;
        }
        if (error.code === "unauthorized" || error.code === "forbidden") {
          this.callbacks.onAuthorization?.(false);
          break;
        }
      }
    }

    if (signal?.aborted === true) cancelled = true;

    if (!cancelled) {
      for (const page of pages) {
        await this.quarantineInvalidRecords(
          runId,
          "auction_listings",
          page,
          page.result.data.records,
          counts,
        );
      }
    }

    const snapshotId = randomUUID();
    const listingRecords = (cancelled ? [] : pages).flatMap((page) =>
      page.result.data.records
        .filter((record): record is ValidatedRecord<CompatibleListing> & { readonly value: CompatibleListing } =>
          record.value !== null && record.state !== "invalid")
        .map((record) => ({ page, record })));
    const preparedListingObservations = await mapWithConcurrency(
      listingRecords,
      WRITE_CONCURRENCY,
      async ({ page, record }): Promise<ListingObservationInput | null> => {
        counts.received += 1;
        try {
          return await listingObservation(
            {
              store: this.store,
              sourceId: this.sourceId,
              runId,
              requestId: page.requestId,
              snapshotId,
              observedAt: page.observedAt,
              page: page.page,
              recordIndex: record.index,
              normalizationVersion: this.config.normalizationVersion,
              dedupeVersion: this.config.dedupeVersion,
            },
            record.value,
            record.raw,
            record.state === "partial",
          );
        } catch (error) {
          if (!isRecordNormalizationFailure(error)) {
            this.metrics.recordFailure("database");
            throw error;
          }
          counts.invalid += 1;
          await this.quarantineNormalizationError(runId, "auction_listings", page, record, error);
          return null;
        }
      },
    );
    const listingObservations = preparedListingObservations.filter(
      (observation): observation is ListingObservationInput => observation !== null,
    );

    const completedAt = new Date();
    const sourceComplete = terminalPageObserved
      && counts.errors.length === 0
      && counts.invalid === 0
      && !cancelled;
    // A cancelled scan deliberately skips normalization during shutdown. Mark it
    // failed so an empty partial snapshot cannot supersede the last usable asks.
    const snapshotStatus = cancelled
      ? "failed"
      : sourceComplete
        ? "complete"
        : pages.length === 0
          ? "failed"
          : "partial";
    const persistedListingIds = await this.store.persistListingSnapshot({
      id: snapshotId,
      runId,
      sourceId: this.sourceId,
      observedAt: startedAt,
      completedAt,
      status: snapshotStatus,
      firstPage: 1,
      ...(pages.at(-1) === undefined ? {} : { lastPage: pages.at(-1)!.page }),
      positionsObserved: pages.reduce((sum, page) => sum + page.result.data.resultPositionCount, 0),
      nonnullListings: pages.reduce(
        (sum, page) => sum + page.result.data.validCount + page.result.data.partialCount + page.result.data.invalidCount,
        0,
      ),
      consistency: "unknown",
      fingerprintVersion: "listing-probabilistic-fingerprint/v1",
      evidence: {
        pageCount: pages.length,
        terminalPageObserved,
        sourceSnapshotAtomic: true,
      },
    }, listingObservations);
    counts.added += persistedListingIds.length;

    const status = finalStatus(cancelled, pages.length, counts, sourceComplete);
    await this.finishRun(runId, "listings", status, startedAt, completedAt, counts, {
      pagesCompleted: pages.map((page) => page.page),
      terminalPageObserved,
      snapshotId,
    });
    return { resource: "listings", runId, status, counts, startedAt, completedAt };
  }

  private async startRun(
    runId: string,
    resource: "auction_transactions" | "auction_listings",
    startedAt: Date,
  ): Promise<void> {
    await this.store.startCollectionRun({
      id: runId,
      sourceId: this.sourceId,
      resource,
      mode: this.config.mode === "one_shot" ? "one_shot" : this.config.mode,
      collectorVersion: this.config.collectorVersion,
      providerVersion: this.config.providerVersion,
      validationVersion: this.config.validationVersion,
      normalizationVersion: this.config.normalizationVersion,
      dedupeVersion: this.config.dedupeVersion,
      scheduleVersion: this.config.scheduleVersion,
      instanceId: this.config.instanceId,
      startedAt,
      configuration: {
        transactionPages: this.config.transactionPages,
        listingMaxPages: this.config.listingMaxPages,
        listingEnabled: this.config.listingEnabled,
        requestsPerMinute: this.config.requestsPerMinute,
        transactionReservePercent: this.config.transactionReservePercent,
        aggregationVersion: this.config.aggregationVersion,
      },
    });
  }

  private async finishRun(
    runId: string,
    resource: "transactions" | "listings",
    status: RunOutcome["status"],
    startedAt: Date,
    completedAt: Date,
    counts: RunCounts,
    continuation: JsonObject,
    additionalGaps: readonly GapInput[] = [],
  ): Promise<void> {
    const latencies = counts.latenciesMs;
    const completion: CollectionRunCompletion = {
      status,
      completedAt,
      requestCount: counts.requests,
      responseCount: counts.responses,
      receivedCount: counts.received,
      newCount: counts.added,
      duplicateCount: counts.duplicates,
      invalidCount: counts.invalid,
      errorSummary: { errors: counts.errors.map(jsonObject) },
      rateLimitSummary: this.budget.snapshot(),
      latencySummary: {
        count: latencies.length,
        maxMs: latencies.length === 0 ? 0 : Math.max(...latencies),
        meanMs: latencies.length === 0 ? 0 : latencies.reduce((sum, value) => sum + value, 0) / latencies.length,
      },
      continuation,
    };
    const partial = status !== "succeeded";
    const gaps: GapInput[] = [...additionalGaps];
    if (partial && status !== "cancelled") {
      gaps.push({
        id: randomUUID(),
        sourceId: this.sourceId,
        resource: resource === "transactions" ? "auction_transactions" : "auction_listings",
        gapStart: startedAt,
        gapEnd: completedAt,
        detectedAt: completedAt,
        reason: "collection_run_incomplete",
        confidence: "possible",
        detectionVersion: "collection-gap/v1",
        evidence: { runId, status, errorCount: counts.errors.length },
        firstRunId: runId,
        lastRunId: runId,
      });
    }
    const healthSample = {
      sourceId: this.sourceId,
      observedAt: completedAt,
      status: status === "succeeded"
        ? "healthy"
        : counts.errors.some((error) => error.code === "unauthorized" || error.code === "forbidden")
          ? "unauthorized"
          : counts.errors.some((error) => error.code === "rate_limited")
            ? "throttled"
            : status === "cancelled"
              ? "unknown"
              : "degraded",
      metrics: {
        durationMs: completedAt.valueOf() - startedAt.valueOf(),
        received: counts.received,
        added: counts.added,
        duplicates: counts.duplicates,
        invalid: counts.invalid,
      },
      reason: status,
      runId,
    } as const;
    const aggregateFrom = aggregationRangeStart(resource, continuation, startedAt, gaps);
    const aggregateTo = aggregationRangeEnd(resource, continuation, completedAt, aggregateFrom);
    try {
      await this.store.finalizeCollectionRun({
        runId,
        completion,
        healthSample,
        gaps,
        checkpoint: {
          sourceId: this.sourceId,
          resource: resource === "transactions" ? "auction_transactions" : "auction_listings",
          checkpointVersion: "collector-checkpoint/v1",
          cursor: continuation,
          nextRunAt: null,
          lastSuccessAt: status === "succeeded" ? completedAt : null,
        },
        aggregateRefresh: {
          sourceId: this.sourceId,
          from: aggregateFrom,
          to: aggregateTo,
          computationVersion: this.config.aggregationVersion,
          dedupeVersion: this.config.dedupeVersion,
          computedAt: completedAt,
        },
      });
    } catch (error) {
      this.metrics.recordFailure("database");
      throw error;
    }
    this.metrics.recordRecords(resource, counts.received, counts.added, counts.duplicates, counts.invalid);
    this.metrics.recordRun(resource, partial);
  }

  private async persistPageFailure(
    runId: string,
    resource: "auction_transactions" | "auction_listings",
    page: number,
    error: CompatibleApiError,
    requestedAt: Date,
    counts: RunCounts,
    attempt = 1,
  ): Promise<void> {
    await persistErrorEvidence(
      this.store,
      this.evidenceContext(runId, resource, page),
      error,
      attempt,
      requestedAt,
    );
    this.metrics.recordRequest(attempt);
    if (error.evidence !== undefined) {
      counts.responses += 1;
      this.metrics.recordResponse(responseLatency(error, requestedAt));
    }
    this.recordError(error, counts);
  }

  private async persistRetryEvidence(
    runId: string,
    resource: "auction_transactions" | "auction_listings",
    page: number,
    event: RetryEvent,
    requestedAt: Date,
    counts: RunCounts,
  ): Promise<void> {
    await persistErrorEvidence(
      this.store,
      this.evidenceContext(runId, resource, page),
      event.error,
      event.failedAttempt,
      requestedAt,
    );
    if (event.error.evidence !== undefined) {
      counts.responses += 1;
      this.metrics.recordResponse(responseLatency(event.error, requestedAt));
    }
    if (event.error.code === "rate_limited") this.metrics.recordFailure("throttle");
    else this.metrics.recordFailure("upstream");
  }

  private recordError(error: CompatibleApiError, counts: RunCounts): void {
    counts.errors.push(jsonObject(error.toJSON()));
    if (error.code === "rate_limited") this.metrics.recordFailure("throttle");
    else if (error.code === "unauthorized" || error.code === "forbidden") {
      this.metrics.recordFailure("authentication");
    } else this.metrics.recordFailure("upstream");
  }

  private async quarantineInvalidRecords<T>(
    runId: string,
    resource: "auction_transactions" | "auction_listings",
    page: PersistedPage<unknown> & { readonly page: number },
    records: readonly ValidatedRecord<T>[],
    counts: RunCounts,
  ): Promise<void> {
    for (const record of records) {
      if (record.state !== "invalid" && record.value !== null) continue;
      counts.received += 1;
      counts.invalid += 1;
      await this.store.appendQuarantinedRecord({
        requestId: page.requestId,
        runId,
        sourceId: this.sourceId,
        resource,
        recordIndex: record.index,
        page: page.page,
        observedAt: page.observedAt,
        rawRecord: jsonValue(record.raw),
        validationErrors: jsonValue(record.issues),
        validationVersion: this.config.validationVersion,
      });
    }
  }

  private async quarantineNormalizationError<T>(
    runId: string,
    resource: "auction_transactions" | "auction_listings",
    page: PersistedPage<unknown> & { readonly page: number },
    record: ValidatedRecord<T>,
    error: unknown,
  ): Promise<void> {
    await this.store.appendQuarantinedRecord({
      requestId: page.requestId,
      runId,
      sourceId: this.sourceId,
      resource,
      recordIndex: record.index,
      page: page.page,
      observedAt: page.observedAt,
      rawRecord: jsonValue(record.raw),
      validationErrors: jsonValue([safeError(error instanceof Error ? error : new Error("Normalization failed"))]),
      validationVersion: this.config.validationVersion,
    });
  }

  private evidenceContext(
    runId: string,
    resource: "auction_transactions" | "auction_listings",
    page: number,
  ) {
    return {
      runId,
      sourceId: this.sourceId,
      resource,
      page,
      providerVersion: this.config.providerVersion,
    } as const;
  }
}

function pageCompleteness(page: TransactionPage | ListingPage): "complete" | "partial" | "empty" {
  if (page.records.length === 0) return "empty";
  return page.invalidCount > 0 || page.partialCount > 0 ? "partial" : "complete";
}

function finalStatus(
  cancelled: boolean,
  pageCount: number,
  counts: RunCounts,
  sourceComplete = true,
): RunOutcome["status"] {
  if (cancelled) return "cancelled";
  if (pageCount === 0) return "failed";
  if (!sourceComplete || counts.errors.length > 0 || counts.invalid > 0) return "partial";
  return "succeeded";
}

function jsonValue(value: unknown): JsonValue {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function jsonObject(value: unknown): JsonObject {
  const normalized = jsonValue(value);
  if (normalized === null || Array.isArray(normalized) || typeof normalized !== "object") {
    return { value: String(value) };
  }
  return normalized;
}

function responseLatency(error: CompatibleApiError, requestedAt: Date): number {
  const observedAt = error.evidence === undefined
    ? requestedAt.valueOf()
    : new Date(error.evidence.observedAt).valueOf();
  return Math.max(0, observedAt - requestedAt.valueOf());
}

function isRecordNormalizationFailure(error: unknown): boolean {
  return error instanceof TypeError || error instanceof RangeError || error instanceof SyntaxError;
}

function aggregationRangeStart(
  resource: "transactions" | "listings",
  continuation: JsonObject,
  fallback: Date,
  gaps: readonly GapInput[],
): Date {
  let earliest = fallback.valueOf();
  if (resource === "transactions") {
    const value = continuation.oldestSourceTimestampMs;
    if (typeof value === "string" && /^\d+$/.test(value)) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) earliest = Math.min(earliest, parsed);
    }
  }
  for (const gap of gaps) earliest = Math.min(earliest, gap.gapStart.valueOf());
  return new Date(earliest);
}

function aggregationRangeEnd(
  resource: "transactions" | "listings",
  continuation: JsonObject,
  fallback: Date,
  from: Date,
): Date {
  let latest = Math.max(fallback.valueOf(), from.valueOf());
  if (resource === "transactions") {
    const value = continuation.newestSourceTimestampMs;
    if (typeof value === "string" && /^\d+$/.test(value)) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) latest = Math.max(latest, parsed);
    }
  }
  return new Date(latest + 1);
}
