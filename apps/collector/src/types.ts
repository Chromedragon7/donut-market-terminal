import type {
  CanonicalItemInput,
  CheckpointState,
  CollectionRunFinalization,
  CollectionRunCompletion,
  CollectionRunInput,
  GapInput,
  HealthSampleInput,
  ItemVariantInput,
  JsonObject,
  Lease,
  ListingObservationInput,
  ListingSnapshotInput,
  QuarantinedRecordInput,
  RawPayloadInput,
  SellerInput,
  SourceInput,
  SourceRequestInput,
  TransactionObservationInput,
  TransactionPersistResult,
} from "@donut/db";

export interface CollectorStore {
  ping(): Promise<boolean>;
  close(): Promise<void>;
  upsertSource(input: SourceInput): Promise<string>;
  startCollectionRun(input: CollectionRunInput): Promise<void>;
  completeCollectionRun(runId: string, completion: CollectionRunCompletion): Promise<void>;
  markAbandonedRunsPartial(sourceId: string, instanceId: string, before: Date): Promise<number>;
  appendFetchEvidence(payload: RawPayloadInput | undefined, request: SourceRequestInput): Promise<void>;
  upsertCanonicalItem(input: CanonicalItemInput): Promise<string>;
  upsertItemVariant(input: ItemVariantInput): Promise<string>;
  upsertSeller(input: SellerInput): Promise<string>;
  persistTransactionObservation(input: TransactionObservationInput): Promise<TransactionPersistResult>;
  persistListingSnapshot(
    snapshot: ListingSnapshotInput,
    observations: readonly ListingObservationInput[],
  ): Promise<readonly string[]>;
  appendQuarantinedRecord(input: QuarantinedRecordInput): Promise<void>;
  appendHealthSample(input: HealthSampleInput): Promise<void>;
  recordGap(input: GapInput): Promise<void>;
  acquireLease(key: string, ownerId: string, ttlMs: number): Promise<Lease | null>;
  renewLease(lease: Lease, ttlMs: number): Promise<Lease | null>;
  releaseLease(lease: Lease): Promise<boolean>;
  withAdvisoryLock<T>(
    lockKey: string,
    operation: (lockSignal: AbortSignal) => Promise<T>,
  ): Promise<{ readonly acquired: boolean; readonly value?: T }>;
  readCheckpoint(sourceId: string, resource: string): Promise<CheckpointState | null>;
  finalizeCollectionRun(input: CollectionRunFinalization): Promise<void>;
  saveCheckpoint(
    sourceId: string,
    resource: string,
    checkpointVersion: string,
    cursor: JsonObject,
    nextRunAt: Date | null,
    lastSuccessAt: Date | null,
  ): Promise<void>;
}

export interface RunCounts {
  requests: number;
  responses: number;
  received: number;
  added: number;
  duplicates: number;
  invalid: number;
  latenciesMs: number[];
  errors: Array<Readonly<Record<string, unknown>>>;
}

export interface RunOutcome {
  readonly resource: "transactions" | "listings";
  readonly runId: string;
  readonly status: "succeeded" | "partial" | "failed" | "cancelled";
  readonly counts: Readonly<RunCounts>;
  readonly startedAt: Date;
  readonly completedAt: Date;
}

export function newRunCounts(): RunCounts {
  return {
    requests: 0,
    responses: 0,
    received: 0,
    added: 0,
    duplicates: 0,
    invalid: 0,
    latenciesMs: [],
    errors: [],
  };
}
