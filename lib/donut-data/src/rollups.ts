import { and, eq, gte } from "drizzle-orm";
import {
  itemVariants,
  marketPriceRollups,
  salesTransactions,
} from "@workspace/db";
import {
  baseScopeKey,
  variantScopeKey,
  parseScopeKey,
  quantile,
  mean as meanOf,
  median as medianOf,
  confidenceScore,
  toNumbers,
} from "@workspace/donut";
import { db } from "./db";

export const INTERVALS = {
  "5m": 5 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
} as const;

export type IntervalKey = keyof typeof INTERVALS;

function bucketStart(ms: number, intervalMs: number): number {
  return Math.floor(ms / intervalMs) * intervalMs;
}

interface SaleRow {
  unitPrice: string;
  quantity: number;
  totalPrice: string;
  sellerUuid: string | null;
  soldAt: Date;
}

async function loadSales(
  scopeKey: string,
  since: Date,
): Promise<SaleRow[]> {
  const parsed = parseScopeKey(scopeKey);
  const condition =
    parsed.scope === "variant"
      ? eq(itemVariants.variantHash, parsed.value)
      : eq(itemVariants.baseItemId, parsed.value);
  const rows = await db
    .select({
      unitPrice: salesTransactions.unitPrice,
      quantity: salesTransactions.quantity,
      totalPrice: salesTransactions.totalPrice,
      sellerUuid: salesTransactions.sellerUuid,
      soldAt: salesTransactions.soldAt,
    })
    .from(salesTransactions)
    .innerJoin(
      itemVariants,
      eq(salesTransactions.itemVariantId, itemVariants.id),
    )
    .where(and(condition, gte(salesTransactions.soldAt, since)));
  return rows;
}

export async function recomputeRollup(
  scopeKey: string,
  interval: IntervalKey,
  since: Date,
): Promise<number> {
  const intervalMs = INTERVALS[interval];
  const sales = await loadSales(scopeKey, since);
  if (sales.length === 0) return 0;

  const buckets = new Map<number, SaleRow[]>();
  for (const s of sales) {
    const b = bucketStart(s.soldAt.getTime(), intervalMs);
    const arr = buckets.get(b);
    if (arr) arr.push(s);
    else buckets.set(b, [s]);
  }

  let written = 0;
  for (const [bucket, rows] of buckets) {
    const sortedByTime = [...rows].sort(
      (a, b) => a.soldAt.getTime() - b.soldAt.getTime(),
    );
    const prices = toNumbers(rows.map((r) => r.unitPrice));
    const soldQuantity = rows.reduce((a, r) => a + r.quantity, 0);
    const totalTraded = rows.reduce(
      (a, r) => a + Number(r.totalPrice),
      0,
    );
    const sellers = new Set(
      rows.map((r) => r.sellerUuid ?? "").filter((x) => x !== ""),
    );
    const newestAge = Date.now() - sortedByTime[sortedByTime.length - 1].soldAt.getTime();
    const confidence = confidenceScore({
      sampleSize: rows.length,
      newestAgeMs: newestAge,
      expectedIntervals: 1,
      observedIntervals: 1,
    });

    await db
      .insert(marketPriceRollups)
      .values({
        scopeKey,
        interval,
        bucketStart: new Date(bucket),
        open: String(Number(sortedByTime[0].unitPrice)),
        high: String(Math.max(...prices)),
        low: String(Math.min(...prices)),
        close: String(Number(sortedByTime[sortedByTime.length - 1].unitPrice)),
        median: nstr(medianOf(prices)),
        mean: nstr(meanOf(prices)),
        p25: nstr(quantile(prices, 0.25)),
        p75: nstr(quantile(prices, 0.75)),
        soldQuantity,
        transactionCount: rows.length,
        totalTradedValue: String(totalTraded),
        distinctSellerCount: sellers.size,
        sampleConfidence: String(confidence),
      })
      .onConflictDoUpdate({
        target: [
          marketPriceRollups.scopeKey,
          marketPriceRollups.interval,
          marketPriceRollups.bucketStart,
        ],
        set: {
          open: String(Number(sortedByTime[0].unitPrice)),
          high: String(Math.max(...prices)),
          low: String(Math.min(...prices)),
          close: String(
            Number(sortedByTime[sortedByTime.length - 1].unitPrice),
          ),
          median: nstr(medianOf(prices)),
          mean: nstr(meanOf(prices)),
          p25: nstr(quantile(prices, 0.25)),
          p75: nstr(quantile(prices, 0.75)),
          soldQuantity,
          transactionCount: rows.length,
          totalTradedValue: String(totalTraded),
          distinctSellerCount: sellers.size,
          sampleConfidence: String(confidence),
        },
      });
    written += 1;
  }
  return written;
}

function nstr(v: number | null): string | null {
  return v === null ? null : String(v);
}

export async function recomputeAffectedScopes(
  scopeKeys: Set<string>,
  intervals: IntervalKey[] = ["5m", "1h", "1d"],
): Promise<number> {
  const lookback: Record<IntervalKey, number> = {
    "5m": 6 * 60 * 60 * 1000,
    "1h": 7 * 24 * 60 * 60 * 1000,
    "1d": 90 * 24 * 60 * 60 * 1000,
  };
  let total = 0;
  for (const scopeKey of scopeKeys) {
    for (const interval of intervals) {
      const since = new Date(Date.now() - lookback[interval]);
      total += await recomputeRollup(scopeKey, interval, since);
    }
  }
  return total;
}

export function scopeKeysForVariant(
  baseItemId: string,
  variantHash: string,
): string[] {
  return [baseScopeKey(baseItemId), variantScopeKey(variantHash)];
}

export async function recomputeAllScopes(
  intervals: IntervalKey[] = ["5m", "1h", "1d"],
): Promise<number> {
  const baseRows = await db
    .selectDistinct({ baseItemId: itemVariants.baseItemId })
    .from(itemVariants);
  const variantRows = await db
    .selectDistinct({ variantHash: itemVariants.variantHash })
    .from(itemVariants);
  const scopes = new Set<string>();
  for (const r of baseRows) scopes.add(baseScopeKey(r.baseItemId));
  for (const r of variantRows) scopes.add(variantScopeKey(r.variantHash));
  return recomputeAffectedScopes(scopes, intervals);
}
