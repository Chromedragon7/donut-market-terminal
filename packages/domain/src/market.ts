import type { VariantCompletenessClass } from "./item.js";
import {
  addRationals,
  calculateStackPricing,
  compareRationals,
  decimalToRational,
  divideRational,
  rationalAmount,
  type DecimalInput,
  type RationalAmount,
} from "./money.js";
import type { ConfidenceLabel } from "./observation.js";

export interface MarketTradeInput {
  readonly totalPrice: DecimalInput;
  readonly quantity: bigint | number;
  readonly soldAtUnixMs: bigint | number;
}

export interface MarketStatistics {
  readonly tradeCount: number;
  readonly recordedQuantity: bigint;
  readonly recordedTurnover: RationalAmount;
  readonly openUnitPrice: RationalAmount | null;
  readonly highUnitPrice: RationalAmount | null;
  readonly lowUnitPrice: RationalAmount | null;
  readonly closeUnitPrice: RationalAmount | null;
  readonly meanUnitPrice: RationalAmount | null;
  readonly medianUnitPrice: RationalAmount | null;
  /** Sum(total stack prices) / sum(recorded item quantity). */
  readonly quantityWeightedMeanUnitPrice: RationalAmount | null;
}

function mean(values: readonly RationalAmount[]): RationalAmount | null {
  if (values.length === 0) return null;
  const sum = values.reduce(addRationals, rationalAmount(0n));
  return divideRational(sum, BigInt(values.length));
}

function median(values: readonly RationalAmount[]): RationalAmount | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort(compareRationals);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[middle]!;
  return divideRational(addRationals(ordered[middle - 1]!, ordered[middle]!), 2n);
}

export function summarizeMarketTrades(trades: readonly MarketTradeInput[]): MarketStatistics {
  const normalized = trades.map((trade, position) => {
    const pricing = calculateStackPricing(trade.totalPrice, trade.quantity);
    const soldAt = typeof trade.soldAtUnixMs === "bigint"
      ? trade.soldAtUnixMs
      : Number.isSafeInteger(trade.soldAtUnixMs)
        ? BigInt(trade.soldAtUnixMs)
        : (() => { throw new TypeError("soldAtUnixMs must be a safe integer or bigint"); })();
    return { pricing, soldAt, position };
  });
  const chronological = [...normalized].sort((left, right) =>
    left.soldAt < right.soldAt ? -1 : left.soldAt > right.soldAt ? 1 : left.position - right.position,
  );
  const unitPrices = normalized.map(({ pricing }) => pricing.unit);
  const recordedQuantity = normalized.reduce((sum, { pricing }) => sum + pricing.quantity, 0n);
  const recordedTurnover = normalized.reduce(
    (sum, { pricing }) => addRationals(sum, decimalToRational(pricing.total)),
    rationalAmount(0n),
  );
  const orderedPrices = [...unitPrices].sort(compareRationals);

  return Object.freeze({
    tradeCount: normalized.length,
    recordedQuantity,
    recordedTurnover,
    openUnitPrice: chronological[0]?.pricing.unit ?? null,
    highUnitPrice: orderedPrices.at(-1) ?? null,
    lowUnitPrice: orderedPrices[0] ?? null,
    closeUnitPrice: chronological.at(-1)?.pricing.unit ?? null,
    meanUnitPrice: mean(unitPrices),
    medianUnitPrice: median(unitPrices),
    quantityWeightedMeanUnitPrice: recordedQuantity === 0n
      ? null
      : divideRational(recordedTurnover, recordedQuantity),
  });
}

export type FreshnessState = "aging" | "expired" | "fresh" | "stale" | "unknown";

export interface FreshnessPolicy {
  readonly freshForMs: bigint | number;
  readonly staleAfterMs: bigint | number;
  readonly expireAfterMs: bigint | number;
}

export interface FreshnessResult {
  readonly state: FreshnessState;
  readonly ageMs: bigint | null;
  readonly observedInFuture: boolean;
}

function milliseconds(value: bigint | number, label: string): bigint {
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new TypeError(`${label} must be a safe integer`);
  return typeof value === "bigint" ? value : BigInt(value);
}

export function classifyFreshness(
  observedAtUnixMs: bigint | number | null,
  nowUnixMs: bigint | number,
  policy: FreshnessPolicy,
): FreshnessResult {
  if (observedAtUnixMs === null) return Object.freeze({ state: "unknown", ageMs: null, observedInFuture: false });
  const observed = milliseconds(observedAtUnixMs, "observedAtUnixMs");
  const now = milliseconds(nowUnixMs, "nowUnixMs");
  const freshFor = milliseconds(policy.freshForMs, "freshForMs");
  const staleAfter = milliseconds(policy.staleAfterMs, "staleAfterMs");
  const expireAfter = milliseconds(policy.expireAfterMs, "expireAfterMs");
  if (freshFor < 0n || staleAfter < freshFor || expireAfter < staleAfter) {
    throw new RangeError("Freshness thresholds must be non-negative and ordered");
  }
  const rawAge = now - observed;
  const observedInFuture = rawAge < 0n;
  const ageMs = observedInFuture ? 0n : rawAge;
  const state: FreshnessState = ageMs <= freshFor
    ? "fresh"
    : ageMs < staleAfter
      ? "aging"
      : ageMs < expireAfter
        ? "stale"
        : "expired";
  return Object.freeze({ state, ageMs, observedInFuture });
}

export interface HistoricalGap {
  readonly afterUnixMs: bigint;
  readonly beforeUnixMs: bigint;
  readonly durationMs: bigint;
  readonly estimatedMissingIntervals: bigint;
}

export interface DetectGapOptions {
  readonly expectedIntervalMs: bigint | number;
  readonly allowedLatenessMs?: bigint | number;
}

export function detectHistoricalGaps(
  timestamps: readonly (bigint | number)[],
  options: DetectGapOptions,
): readonly HistoricalGap[] {
  const expected = milliseconds(options.expectedIntervalMs, "expectedIntervalMs");
  const lateness = milliseconds(options.allowedLatenessMs ?? 0, "allowedLatenessMs");
  if (expected <= 0n || lateness < 0n) throw new RangeError("Gap intervals must be positive and lateness non-negative");
  const sorted = [...new Set(timestamps.map((value) => milliseconds(value, "timestamp").toString()))]
    .map(BigInt)
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  const gaps: HistoricalGap[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const after = sorted[index - 1]!;
    const before = sorted[index]!;
    const duration = before - after;
    if (duration > expected + lateness) {
      gaps.push(Object.freeze({
        afterUnixMs: after,
        beforeUnixMs: before,
        durationMs: duration,
        estimatedMissingIntervals: (duration - 1n) / expected,
      }));
    }
  }
  return Object.freeze(gaps);
}

export interface ConfidenceInput {
  readonly sampleSize: number;
  readonly completeness: VariantCompletenessClass;
  readonly freshness: FreshnessState;
  readonly gapCount: number;
  readonly sourceHealthy: boolean;
}

export interface ConfidenceResult {
  readonly label: ConfidenceLabel;
  readonly score: number;
  readonly reasons: readonly string[];
}

/** Transparent heuristic for UI guidance; never represents statistical certainty. */
export function assessConfidence(input: ConfidenceInput): ConfidenceResult {
  if (!Number.isSafeInteger(input.sampleSize) || input.sampleSize < 0) throw new RangeError("sampleSize must be non-negative");
  if (!Number.isSafeInteger(input.gapCount) || input.gapCount < 0) throw new RangeError("gapCount must be non-negative");
  if (input.sampleSize === 0 || input.freshness === "unknown" || input.completeness === "unclassified") {
    return Object.freeze({ label: "unavailable", score: 0, reasons: Object.freeze(["insufficient_evidence"]) });
  }

  let score = 100;
  const reasons: string[] = [];
  if (input.sampleSize < 3) { score -= 45; reasons.push("sample_size_below_3"); }
  else if (input.sampleSize < 10) { score -= 25; reasons.push("sample_size_below_10"); }
  else if (input.sampleSize < 30) { score -= 10; reasons.push("sample_size_below_30"); }

  const completenessPenalty: Partial<Record<VariantCompletenessClass, number>> = {
    strong_match: 10,
    broad_base_item_match: 25,
    incomplete_metadata: 40,
    ambiguous: 55,
    excluded_from_analytics: 100,
  };
  const penalty = completenessPenalty[input.completeness] ?? 0;
  if (penalty > 0) { score -= penalty; reasons.push(`completeness_${input.completeness}`); }

  if (input.freshness === "aging") { score -= 10; reasons.push("data_aging"); }
  else if (input.freshness === "stale") { score -= 30; reasons.push("data_stale"); }
  else if (input.freshness === "expired") { score -= 60; reasons.push("data_expired"); }
  if (!input.sourceHealthy) { score -= 25; reasons.push("source_unhealthy"); }
  if (input.gapCount > 0) { score -= Math.min(35, input.gapCount * 10); reasons.push("historical_gaps_present"); }
  score = Math.max(0, Math.min(100, score));
  const label: ConfidenceLabel = score >= 80 ? "high" : score >= 50 ? "medium" : "low";
  return Object.freeze({ label, score, reasons: Object.freeze(reasons) });
}
