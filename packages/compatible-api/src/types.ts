import type {
  CanonicalItemVariant,
  ProbabilisticListingFingerprint,
  SourceItemForNormalization,
  StackPricing,
  TransactionFingerprint,
} from "@donut/domain";

export type ValidationSeverity = "error" | "info" | "warning";
export type RecordValidationState = "invalid" | "partial" | "valid";

export interface ValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly severity: ValidationSeverity;
  readonly message: string;
  readonly actualType?: string;
}

export interface CompatibleSeller {
  readonly name: string | null;
  readonly uuid: string | null;
}

export interface CompatibleTransaction {
  readonly sourceItem: SourceItemForNormalization;
  readonly seller: CompatibleSeller;
  readonly totalPriceLexeme: string;
  readonly soldAtUnixMs: bigint;
  readonly normalizedVariant: CanonicalItemVariant;
  readonly stackPricing: StackPricing;
  readonly fingerprint: TransactionFingerprint;
  /** Scan-local multiset identity; it is not a durable upstream transaction id. */
  readonly occurrenceOrdinal: number;
  readonly occurrenceKey: string;
  readonly identicalOccurrenceCount: number;
  readonly collisionAmbiguous: boolean;
}

export interface CompatibleListing {
  readonly sourceItem: SourceItemForNormalization;
  readonly seller: CompatibleSeller;
  readonly totalPriceLexeme: string;
  readonly timeLeftMs: bigint | null;
  readonly normalizedVariant: CanonicalItemVariant;
  readonly stackPricing: StackPricing;
  readonly probabilisticFingerprint: ProbabilisticListingFingerprint;
}

export interface ValidatedRecord<T> {
  readonly index: number;
  readonly state: RecordValidationState;
  readonly value: T | null;
  readonly raw: unknown;
  readonly issues: readonly ValidationIssue[];
}

export interface TransactionPage {
  readonly kind: "transactions";
  readonly page: number;
  readonly httpBodyStatus: number | null;
  readonly records: readonly ValidatedRecord<CompatibleTransaction>[];
  readonly issues: readonly ValidationIssue[];
  readonly validCount: number;
  readonly partialCount: number;
  readonly invalidCount: number;
}

export interface ListingPage {
  readonly kind: "listings";
  readonly page: number;
  readonly httpBodyStatus: number | null;
  readonly records: readonly ValidatedRecord<CompatibleListing>[];
  readonly nullPaddingCount: number;
  readonly nullPaddingPositions: readonly number[];
  readonly resultPositionCount: number;
  readonly issues: readonly ValidationIssue[];
  readonly validCount: number;
  readonly partialCount: number;
  readonly invalidCount: number;
}

export interface ParseEnvelopeContext {
  readonly sourceId: string;
  readonly page: number;
  readonly observedAtUnixMs: bigint | number;
}
