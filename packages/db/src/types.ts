import type { PoolClient, QueryResult, QueryResultRow } from "pg";

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

/** Money crosses the JavaScript boundary as canonical decimal text, never a float. */
export type DecimalText = string;

export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<R>>;
}

export type TransactionClient = PoolClient;

export type CollectionResource =
  | "auction_transactions"
  | "auction_listings"
  | "metadata"
  | "backfill";

export type CollectionRunStatus =
  | "running"
  | "succeeded"
  | "partial"
  | "failed"
  | "cancelled";

export interface SourceInput {
  readonly key: string;
  readonly type: string;
  readonly displayName: string;
  readonly endpointMetadata?: JsonObject;
  readonly enabled?: boolean;
  readonly trustLevel?: "unverified" | "community" | "compatible" | "authoritative";
}

export interface CollectionRunInput {
  readonly id: string;
  readonly sourceId: string;
  readonly resource: CollectionResource;
  readonly mode: "one_shot" | "continuous" | "validation" | "backfill";
  readonly collectorVersion: string;
  readonly providerVersion: string;
  readonly validationVersion: string;
  readonly normalizationVersion: string;
  readonly dedupeVersion: string;
  readonly scheduleVersion: string;
  readonly instanceId: string;
  readonly startedAt: Date;
  readonly configuration?: JsonObject;
}

export interface CollectionRunCompletion {
  readonly status: Exclude<CollectionRunStatus, "running">;
  readonly completedAt: Date;
  readonly requestCount: number;
  readonly responseCount: number;
  readonly receivedCount: number;
  readonly newCount: number;
  readonly duplicateCount: number;
  readonly invalidCount: number;
  readonly errorSummary?: JsonObject;
  readonly rateLimitSummary?: JsonObject;
  readonly latencySummary?: JsonObject;
  readonly continuation?: JsonObject;
}

export interface RawPayloadInput {
  readonly sha256: string;
  readonly bytes: Uint8Array;
  readonly contentType?: string;
  readonly contentEncoding?: string;
  readonly firstObservedAt: Date;
}

export interface SourceRequestInput {
  readonly id: string;
  readonly runId: string;
  readonly sourceId: string;
  readonly resource: CollectionResource;
  readonly page?: number;
  readonly attempt: number;
  readonly requestedAt: Date;
  readonly respondedAt?: Date;
  readonly latencyMs?: number;
  readonly httpStatus?: number;
  readonly requestMetadata?: JsonObject;
  readonly responsePayloadSha256?: string;
  readonly responseBytes?: number;
  readonly validationStatus: "not_attempted" | "valid" | "partially_valid" | "invalid";
  readonly completenessStatus: "unknown" | "complete" | "partial" | "empty";
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly rateLimitMetadata?: JsonObject;
  readonly providerVersion: string;
}

export interface CanonicalItemInput {
  readonly id: string;
  readonly minecraftId: string;
  readonly namespace: string;
  readonly path: string;
  readonly displayName?: string;
}

export interface ItemVariantInput {
  readonly id: string;
  readonly canonicalItemId: string;
  readonly fingerprint: string;
  readonly fingerprintVersion: string;
  readonly canonicalMetadata: JsonObject;
  readonly identityState:
    | "exact"
    | "strong"
    | "broad"
    | "incomplete"
    | "ambiguous"
    | "unclassified"
    | "excluded";
  readonly completeness: JsonObject;
}

export interface SellerInput {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceSellerId: string;
  readonly currentName?: string;
  readonly observedAt: Date;
  readonly visibilityPolicy?: "owner_full" | "name_only" | "pseudonymized" | "hidden";
}

export interface TransactionObservationInput {
  readonly requestId: string;
  readonly runId: string;
  readonly sourceId: string;
  readonly recordIndex: number;
  readonly page: number;
  readonly pagePosition: number;
  readonly observedAt: Date;
  readonly sourceSoldAt: Date;
  readonly canonicalItemId: string;
  readonly itemVariantId: string;
  readonly sellerId?: string;
  readonly quantity: number;
  readonly totalPrice: DecimalText;
  readonly totalPriceSourceText: string;
  readonly unitPrice: DecimalText;
  readonly unitPriceExactText: string;
  readonly unitPriceNumerator: string;
  readonly unitPriceDenominator: string;
  readonly fingerprint: string;
  readonly occurrenceOrdinal: number;
  readonly collisionAmbiguous: boolean;
  readonly fingerprintVersion: string;
  readonly dedupeVersion: string;
  readonly normalizationVersion: string;
  readonly validationStatus: "valid" | "quarantined";
  readonly confidence: "high" | "medium" | "low" | "unknown";
  readonly flags?: JsonObject;
  readonly rawRecord?: JsonValue;
}

export interface TransactionPersistResult {
  readonly observationId: string;
  readonly logicalTransactionId?: string;
  readonly isNewLogicalTransaction: boolean;
}

export interface ListingSnapshotInput {
  readonly id: string;
  readonly runId: string;
  readonly sourceId: string;
  readonly observedAt: Date;
  readonly completedAt?: Date;
  readonly status: "complete" | "partial" | "failed";
  readonly search?: string;
  readonly sort?: string;
  readonly firstPage: number;
  readonly lastPage?: number;
  readonly positionsObserved: number;
  readonly nonnullListings: number;
  readonly consistency: "consistent" | "changed_during_scan" | "unknown";
  readonly fingerprintVersion: string;
  readonly evidence?: JsonObject;
}

export interface ListingObservationInput {
  readonly requestId: string;
  readonly snapshotId: string;
  readonly runId: string;
  readonly sourceId: string;
  readonly recordIndex: number;
  readonly page: number;
  readonly pagePosition: number;
  readonly observedAt: Date;
  readonly canonicalItemId: string;
  readonly itemVariantId: string;
  readonly sellerId?: string;
  readonly quantity: number;
  readonly totalAskPrice: DecimalText;
  readonly totalAskPriceSourceText: string;
  readonly unitAskPrice: DecimalText;
  readonly unitAskPriceExactText: string;
  readonly unitAskPriceNumerator: string;
  readonly unitAskPriceDenominator: string;
  readonly remainingTimeText?: string;
  readonly approximateExpiresAt?: Date;
  readonly fingerprint: string;
  readonly fingerprintVersion: string;
  readonly confidence: "high" | "medium" | "low" | "unknown";
  readonly flags?: JsonObject;
  readonly rawRecord?: JsonValue;
}

export interface HealthSampleInput {
  readonly sourceId: string;
  readonly observedAt: Date;
  readonly status:
    | "healthy"
    | "delayed"
    | "throttled"
    | "degraded"
    | "offline"
    | "unauthorized"
    | "unknown";
  readonly metrics?: JsonObject;
  readonly reason?: string;
  readonly runId?: string;
}

export interface QuarantinedRecordInput {
  readonly requestId: string;
  readonly runId: string;
  readonly sourceId: string;
  readonly resource: CollectionResource;
  readonly recordIndex: number;
  readonly page?: number;
  readonly observedAt: Date;
  readonly rawRecord?: JsonValue;
  readonly validationErrors: JsonValue;
  readonly validationVersion: string;
}

export interface GapInput {
  readonly id: string;
  readonly sourceId: string;
  readonly resource: CollectionResource;
  readonly gapStart: Date;
  readonly gapEnd?: Date;
  readonly detectedAt: Date;
  readonly reason: string;
  readonly confidence: "confirmed" | "likely" | "possible" | "unknown";
  readonly detectionVersion: string;
  readonly evidence?: JsonObject;
  readonly firstRunId?: string;
  readonly lastRunId?: string;
}

export interface CheckpointInput {
  readonly sourceId: string;
  readonly resource: string;
  readonly checkpointVersion: string;
  readonly cursor: JsonObject;
  readonly nextRunAt: Date | null;
  readonly lastSuccessAt: Date | null;
}

export interface CheckpointState {
  readonly sourceId: string;
  readonly resource: string;
  readonly checkpointVersion: string;
  readonly cursor: JsonObject;
  readonly nextRunAt: Date | null;
  readonly lastSuccessAt: Date | null;
  readonly updatedAt: Date;
}

export interface CollectionRunFinalization {
  readonly runId: string;
  readonly completion: CollectionRunCompletion;
  readonly healthSample: HealthSampleInput;
  readonly gaps?: readonly GapInput[];
  readonly checkpoint: CheckpointInput;
  readonly aggregateRefresh?: AggregationRefreshInput;
}

export interface AggregationRefreshInput {
  readonly sourceId: string;
  readonly from: Date;
  readonly to: Date;
  readonly computationVersion: string;
  /** Selects exactly one logical-transaction generation during dedupe upgrades. */
  readonly dedupeVersion: string;
  readonly computedAt: Date;
}

export interface AggregationRefreshResult {
  readonly saleCandles: number;
  readonly askCandles: number;
  readonly summaries: number;
}

export interface Lease {
  readonly key: string;
  readonly ownerId: string;
  readonly fencingToken: string;
  readonly acquiredAt: Date;
  readonly expiresAt: Date;
}

export interface OutboxEventInput {
  readonly eventId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly audience: "owner" | "authenticated" | "admin" | "internal";
  readonly payload: JsonObject;
  readonly occurredAt: Date;
}

export interface OutboxEvent {
  readonly cursor: string;
  readonly eventId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly audience: "owner" | "authenticated" | "admin" | "internal";
  readonly payload: JsonObject;
  readonly occurredAt: Date;
}

export interface AuditEventInput {
  readonly eventId: string;
  readonly actorUserId?: string;
  readonly actorSessionId?: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId?: string;
  readonly beforeState?: JsonObject;
  readonly afterState?: JsonObject;
  readonly requestId?: string;
  readonly networkFingerprint?: string;
  readonly occurredAt: Date;
}
