import { randomUUID } from "node:crypto";
import type { CompatibleListing, CompatibleSeller, CompatibleTransaction } from "@donut/compatible-api";
import type {
  ItemVariantInput,
  JsonObject,
  JsonValue,
  ListingObservationInput,
  TransactionObservationInput,
} from "@donut/db";
import {
  rationalToFixed,
  rationalToString,
  type CanonicalItemVariant,
  type ConfidenceLabel,
} from "@donut/domain";
import type { CollectorStore } from "./types.js";

export interface NormalizationContext {
  readonly store: CollectorStore;
  readonly sourceId: string;
  readonly runId: string;
  readonly requestId: string;
  readonly observedAt: Date;
  readonly page: number;
  readonly recordIndex: number;
  readonly normalizationVersion: string;
  readonly dedupeVersion: string;
}

export async function transactionObservation(
  context: NormalizationContext,
  record: CompatibleTransaction,
  occurrenceOrdinal: number,
  collisionAmbiguous: boolean,
  raw: unknown,
  partial: boolean,
): Promise<TransactionObservationInput> {
  const identity = await persistIdentity(context, record.normalizedVariant, record.seller);
  const quantity = sqlQuantity(record.stackPricing.quantity);
  const soldAt = epochMilliseconds(record.soldAtUnixMs, "soldAtUnixMs");
  return {
    requestId: context.requestId,
    runId: context.runId,
    sourceId: context.sourceId,
    recordIndex: context.recordIndex,
    page: context.page,
    pagePosition: context.recordIndex,
    observedAt: context.observedAt,
    sourceSoldAt: soldAt,
    canonicalItemId: identity.canonicalItemId,
    itemVariantId: identity.variantId,
    ...(identity.sellerId === undefined ? {} : { sellerId: identity.sellerId }),
    quantity,
    totalPrice: record.stackPricing.totalCanonical,
    totalPriceSourceText: record.totalPriceLexeme,
    unitPrice: rationalToFixed(record.stackPricing.unit, 18),
    unitPriceExactText: rationalToString(record.stackPricing.unit),
    unitPriceNumerator: record.stackPricing.unit.numerator.toString(),
    unitPriceDenominator: record.stackPricing.unit.denominator.toString(),
    fingerprint: record.fingerprint.value,
    occurrenceOrdinal,
    collisionAmbiguous,
    fingerprintVersion: record.fingerprint.algorithm,
    dedupeVersion: context.dedupeVersion,
    normalizationVersion: context.normalizationVersion,
    validationStatus: "valid",
    confidence: collisionAmbiguous ? "low" : confidence(record.normalizedVariant, partial),
    flags: {
      collisionAmbiguous,
      metadataClassification: record.normalizedVariant.completeness.classification,
      partialSourceRecord: partial,
    },
    rawRecord: jsonValue(raw),
  };
}

export async function listingObservation(
  context: NormalizationContext & { readonly snapshotId: string },
  record: CompatibleListing,
  raw: unknown,
  partial: boolean,
): Promise<ListingObservationInput> {
  const identity = await persistIdentity(context, record.normalizedVariant, record.seller);
  const quantity = sqlQuantity(record.stackPricing.quantity);
  const approximateExpiresAt = record.probabilisticFingerprint.approximateExpirationUnixMs === null
    ? undefined
    : epochMilliseconds(record.probabilisticFingerprint.approximateExpirationUnixMs, "expiration");
  return {
    requestId: context.requestId,
    snapshotId: context.snapshotId,
    runId: context.runId,
    sourceId: context.sourceId,
    recordIndex: context.recordIndex,
    page: context.page,
    pagePosition: context.recordIndex,
    observedAt: context.observedAt,
    canonicalItemId: identity.canonicalItemId,
    itemVariantId: identity.variantId,
    ...(identity.sellerId === undefined ? {} : { sellerId: identity.sellerId }),
    quantity,
    totalAskPrice: record.stackPricing.totalCanonical,
    totalAskPriceSourceText: record.totalPriceLexeme,
    unitAskPrice: rationalToFixed(record.stackPricing.unit, 18),
    unitAskPriceExactText: rationalToString(record.stackPricing.unit),
    unitAskPriceNumerator: record.stackPricing.unit.numerator.toString(),
    unitAskPriceDenominator: record.stackPricing.unit.denominator.toString(),
    ...(record.timeLeftMs === null ? {} : { remainingTimeText: record.timeLeftMs.toString() }),
    ...(approximateExpiresAt === undefined ? {} : { approximateExpiresAt }),
    fingerprint: record.probabilisticFingerprint.value,
    fingerprintVersion: record.probabilisticFingerprint.algorithm,
    confidence: confidence(record.normalizedVariant, partial),
    flags: {
      fingerprintKind: "probabilistic",
      metadataClassification: record.normalizedVariant.completeness.classification,
      partialSourceRecord: partial,
      stableListingIdentity: false,
      uncertaintyReasons: [...record.probabilisticFingerprint.uncertaintyReasons],
    },
    rawRecord: jsonValue(raw),
  };
}

interface PersistedIdentity {
  readonly canonicalItemId: string;
  readonly variantId: string;
  readonly sellerId?: string;
}

async function persistIdentity(
  context: NormalizationContext,
  variant: CanonicalItemVariant,
  seller: CompatibleSeller,
): Promise<PersistedIdentity> {
  const minecraftId = variant.baseItemId;
  if (minecraftId === null) {
    throw new TypeError("Cannot normalize an item without a canonical Minecraft id");
  }
  const separator = minecraftId.indexOf(":");
  if (separator <= 0 || separator === minecraftId.length - 1) {
    throw new TypeError("Canonical Minecraft ids must contain a non-empty namespace and path");
  }
  const namespace = minecraftId.slice(0, separator);
  const path = minecraftId.slice(separator + 1);
  const canonicalItemId = await context.store.upsertCanonicalItem({
    id: randomUUID(),
    minecraftId,
    namespace,
    path,
  });
  const variantId = await context.store.upsertItemVariant({
    id: randomUUID(),
    canonicalItemId,
    fingerprint: variant.fingerprint,
    fingerprintVersion: variant.schemaVersion,
    canonicalMetadata: jsonObject(JSON.parse(variant.identityJson)),
    identityState: identityState(variant),
    completeness: {
      classification: variant.completeness.classification,
      reasons: [...variant.completeness.reasons],
      suitableForExactAnalytics: variant.completeness.suitableForExactAnalytics,
    },
  });
  const sourceSellerId = seller.uuid?.trim() || seller.name?.normalize("NFC").trim().toLowerCase();
  if (sourceSellerId === undefined || sourceSellerId.length === 0) {
    return { canonicalItemId, variantId };
  }
  const sellerId = await context.store.upsertSeller({
    id: randomUUID(),
    sourceId: context.sourceId,
    sourceSellerId,
    ...(seller.name === null ? {} : { currentName: seller.name }),
    observedAt: context.observedAt,
    visibilityPolicy: "owner_full",
  });
  return { canonicalItemId, variantId, sellerId };
}

function identityState(variant: CanonicalItemVariant): ItemVariantInput["identityState"] {
  switch (variant.completeness.classification) {
    case "exact_match": return "exact";
    case "strong_match": return "strong";
    case "broad_base_item_match": return "broad";
    case "incomplete_metadata": return "incomplete";
    case "ambiguous": return "ambiguous";
    case "excluded_from_analytics": return "excluded";
    case "unclassified": return "unclassified";
  }
}

function confidence(variant: CanonicalItemVariant, partial: boolean): Exclude<ConfidenceLabel, "unavailable"> | "unknown" {
  if (variant.completeness.classification === "exact_match" && !partial) return "high";
  if (
    variant.completeness.classification === "strong_match"
    || variant.completeness.classification === "broad_base_item_match"
  ) return partial ? "low" : "medium";
  return "low";
}

function sqlQuantity(quantity: bigint): number {
  if (quantity <= 0n || quantity > 2_147_483_647n) {
    throw new RangeError("Quantity is outside the PostgreSQL positive integer range");
  }
  return Number(quantity);
}

function epochMilliseconds(value: bigint, label: string): Date {
  if (value <= 0n || value > 8_640_000_000_000_000n) {
    throw new RangeError(`${label} is outside the JavaScript Date range`);
  }
  const date = new Date(Number(value));
  if (Number.isNaN(date.valueOf())) throw new RangeError(`${label} is invalid`);
  return date;
}

function jsonValue(value: unknown): JsonValue {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function jsonObject(value: unknown): JsonObject {
  const normalized = jsonValue(value);
  if (normalized === null || Array.isArray(normalized) || typeof normalized !== "object") {
    throw new TypeError("Expected canonical variant identity to be a JSON object");
  }
  return normalized;
}
