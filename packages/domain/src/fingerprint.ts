import { fingerprintJson, type JsonValue } from "./json.js";
import { calculateStackPricing, type DecimalInput } from "./money.js";

export interface TransactionFingerprintInput {
  readonly sourceId: string;
  readonly itemVariantFingerprint: string;
  readonly sellerUuid: string | null;
  readonly sellerName: string | null;
  readonly totalPrice: DecimalInput;
  readonly quantity: bigint | number;
  readonly soldAtUnixMs: bigint | number | string;
}

export interface TransactionFingerprint {
  readonly algorithm: "transaction-fingerprint/v1";
  readonly value: string;
  readonly canonicalIdentity: JsonValue;
}

function integer(value: bigint | number | string, label: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new TypeError(`${label} must be a safe integer or exact integer string`);
    return BigInt(value);
  }
  if (!/^-?\d+$/.test(value)) throw new TypeError(`${label} must be an integer string`);
  return BigInt(value);
}

function sellerIdentity(uuid: string | null, name: string | null): JsonValue {
  const normalizedUuid = uuid?.trim().toLowerCase() || null;
  const normalizedName = name?.normalize("NFC").trim().toLowerCase() || null;
  return { name: normalizedUuid === null ? normalizedName : null, uuid: normalizedUuid };
}

export function createTransactionFingerprint(input: TransactionFingerprintInput): TransactionFingerprint {
  const soldAtUnixMs = integer(input.soldAtUnixMs, "soldAtUnixMs");
  if (soldAtUnixMs <= 0n) throw new RangeError("soldAtUnixMs must be positive");
  const pricing = calculateStackPricing(input.totalPrice, input.quantity);
  const identity: JsonValue = {
    algorithm: "transaction-fingerprint/v1",
    itemVariantFingerprint: input.itemVariantFingerprint,
    quantity: pricing.quantity.toString(),
    seller: sellerIdentity(input.sellerUuid, input.sellerName),
    soldAtUnixMs: soldAtUnixMs.toString(),
    sourceId: input.sourceId,
    totalPrice: pricing.totalCanonical,
  };
  return Object.freeze({
    algorithm: "transaction-fingerprint/v1",
    value: fingerprintJson(identity),
    canonicalIdentity: identity,
  });
}

export interface TransactionOccurrence<T> {
  readonly record: T;
  readonly baseFingerprint: string;
  /** One-based position among identical records in this observation/scan only. */
  readonly occurrenceOrdinal: number;
  readonly occurrenceKey: string;
  readonly identicalOccurrenceCount: number;
  readonly collisionAmbiguous: boolean;
}

/**
 * Preserves a page/scan as a multiset. Ordinals do not claim identity across
 * scans; they only prevent valid identical same-millisecond sales being lost.
 */
export function assignTransactionOccurrenceOrdinals<T>(
  records: readonly T[],
  fingerprint: (record: T) => string,
): readonly TransactionOccurrence<T>[] {
  const totals = new Map<string, number>();
  for (const record of records) {
    const value = fingerprint(record);
    totals.set(value, (totals.get(value) ?? 0) + 1);
  }

  const seen = new Map<string, number>();
  return Object.freeze(records.map((record) => {
    const baseFingerprint = fingerprint(record);
    const occurrenceOrdinal = (seen.get(baseFingerprint) ?? 0) + 1;
    seen.set(baseFingerprint, occurrenceOrdinal);
    const identicalOccurrenceCount = totals.get(baseFingerprint)!;
    return Object.freeze({
      record,
      baseFingerprint,
      occurrenceOrdinal,
      occurrenceKey: `${baseFingerprint}:${occurrenceOrdinal}`,
      identicalOccurrenceCount,
      collisionAmbiguous: identicalOccurrenceCount > 1,
    });
  }));
}

export interface ListingObservationFingerprintInput {
  readonly sourceId: string;
  readonly itemVariantFingerprint: string;
  readonly sellerUuid: string | null;
  readonly sellerName: string | null;
  readonly totalPrice: DecimalInput;
  readonly quantity: bigint | number;
  readonly observedAtUnixMs: bigint | number | string;
  readonly timeLeftMs: bigint | number | string | null;
  readonly expirationBucketMs?: bigint | number;
}

export interface ProbabilisticListingFingerprint {
  readonly algorithm: "listing-probabilistic-fingerprint/v1";
  readonly kind: "probabilistic";
  readonly stableIdentity: false;
  readonly value: string;
  readonly approximateExpirationUnixMs: bigint | null;
  readonly uncertaintyReasons: readonly string[];
}

export function createListingObservationFingerprint(
  input: ListingObservationFingerprintInput,
): ProbabilisticListingFingerprint {
  const observedAt = integer(input.observedAtUnixMs, "observedAtUnixMs");
  const timeLeft = input.timeLeftMs === null ? null : integer(input.timeLeftMs, "timeLeftMs");
  if (timeLeft !== null && timeLeft < 0n) throw new RangeError("timeLeftMs cannot be negative");
  const bucket = integer(input.expirationBucketMs ?? 1_000, "expirationBucketMs");
  if (bucket <= 0n) throw new RangeError("expirationBucketMs must be positive");

  const pricing = calculateStackPricing(input.totalPrice, input.quantity);
  const approximateExpiration = timeLeft === null ? null : observedAt + timeLeft;
  const expirationBucket = approximateExpiration === null ? null : (approximateExpiration / bucket) * bucket;
  const uncertaintyReasons = [
    "upstream_has_no_stable_listing_id",
    "identical_listings_can_share_a_fingerprint",
    "remaining_time_and_network_latency_make_expiration_approximate",
  ];
  if (input.sellerUuid === null) uncertaintyReasons.push("seller_uuid_missing");
  if (timeLeft === null) uncertaintyReasons.push("remaining_time_missing");

  const identity: JsonValue = {
    algorithm: "listing-probabilistic-fingerprint/v1",
    approximateExpirationBucketUnixMs: expirationBucket?.toString() ?? null,
    itemVariantFingerprint: input.itemVariantFingerprint,
    quantity: pricing.quantity.toString(),
    seller: sellerIdentity(input.sellerUuid, input.sellerName),
    sourceId: input.sourceId,
    totalPrice: pricing.totalCanonical,
  };
  return Object.freeze({
    algorithm: "listing-probabilistic-fingerprint/v1",
    kind: "probabilistic",
    stableIdentity: false,
    value: fingerprintJson(identity),
    approximateExpirationUnixMs: approximateExpiration,
    uncertaintyReasons: Object.freeze(uncertaintyReasons),
  });
}
