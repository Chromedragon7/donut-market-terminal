import { Decimal } from "./money";

export function toNumbers(values: Array<string | number>): number[] {
  return values
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
}

export function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

export function median(sorted: number[]): number | null {
  return quantile(sorted, 0.5);
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function medianAbsoluteDeviation(sorted: number[]): number | null {
  const med = median(sorted);
  if (med === null) return null;
  const deviations = sorted
    .map((v) => Math.abs(v - med))
    .sort((a, b) => a - b);
  return median(deviations);
}

export function iqrBounds(
  sorted: number[],
): { lower: number; upper: number } | null {
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  if (q1 === null || q3 === null) return null;
  const iqr = q3 - q1;
  return { lower: q1 - 1.5 * iqr, upper: q3 + 1.5 * iqr };
}

export interface Candle {
  bucketStart: number;
  open: number;
  high: number;
  low: number;
  close: number;
  median: number | null;
  volume: number;
  count: number;
}

export interface SalePoint {
  soldAtMs: number;
  unitPrice: number;
  quantity: number;
}

export function buildCandles(
  sales: SalePoint[],
  intervalMs: number,
): Candle[] {
  if (sales.length === 0) return [];
  const sorted = [...sales].sort((a, b) => a.soldAtMs - b.soldAtMs);
  const buckets = new Map<number, SalePoint[]>();
  for (const s of sorted) {
    const bucket = Math.floor(s.soldAtMs / intervalMs) * intervalMs;
    const arr = buckets.get(bucket);
    if (arr) arr.push(s);
    else buckets.set(bucket, [s]);
  }
  const result: Candle[] = [];
  for (const [bucketStart, points] of [...buckets.entries()].sort(
    (a, b) => a[0] - b[0],
  )) {
    const prices = points.map((p) => p.unitPrice);
    const sortedPrices = [...prices].sort((a, b) => a - b);
    result.push({
      bucketStart,
      open: prices[0],
      high: Math.max(...prices),
      low: Math.min(...prices),
      close: prices[prices.length - 1],
      median: median(sortedPrices),
      volume: points.reduce((a, p) => a + p.quantity, 0),
      count: points.length,
    });
  }
  return result;
}

export function pctChange(
  current: number | null,
  previous: number | null,
): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return new Decimal(current)
    .minus(previous)
    .div(previous)
    .mul(100)
    .toDecimalPlaces(2)
    .toNumber();
}

export interface ConfidenceInput {
  sampleSize: number;
  newestAgeMs: number | null;
  expectedIntervals: number;
  observedIntervals: number;
}

export function confidenceScore(input: ConfidenceInput): number {
  const sizeScore = Math.min(input.sampleSize / 30, 1);
  const recencyScore =
    input.newestAgeMs === null
      ? 0
      : Math.max(0, 1 - input.newestAgeMs / (24 * 3600 * 1000));
  const coverageScore =
    input.expectedIntervals > 0
      ? Math.min(input.observedIntervals / input.expectedIntervals, 1)
      : 1;
  const score = 0.5 * sizeScore + 0.3 * recencyScore + 0.2 * coverageScore;
  return Math.round(score * 100) / 100;
}

export type MarketSignal =
  | "below_median"
  | "above_median"
  | "high_liquidity"
  | "low_sample_size"
  | "unusually_volatile";

export function deriveSignals(input: {
  bestAsk: number | null;
  recentMedianSale: number | null;
  salesCount: number;
  madRatio: number | null;
}): MarketSignal[] {
  const signals: MarketSignal[] = [];
  if (input.salesCount < 5) signals.push("low_sample_size");
  if (input.salesCount >= 30) signals.push("high_liquidity");
  if (
    input.bestAsk !== null &&
    input.recentMedianSale !== null &&
    input.recentMedianSale > 0
  ) {
    if (input.bestAsk < input.recentMedianSale * 0.95)
      signals.push("below_median");
    else if (input.bestAsk > input.recentMedianSale * 1.05)
      signals.push("above_median");
  }
  if (input.madRatio !== null && input.madRatio > 0.25)
    signals.push("unusually_volatile");
  return signals;
}
