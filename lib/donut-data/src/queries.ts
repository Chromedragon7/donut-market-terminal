import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  currentAuctionListings,
  itemVariants,
  salesTransactions,
} from "@workspace/db";
import {
  baseScopeKey,
  variantScopeKey,
  parseScopeKey,
  median as medianOf,
  mean as meanOf,
  quantile,
  medianAbsoluteDeviation,
  pctChange,
  confidenceScore,
  toNumbers,
  buildCandles,
  deriveSignals,
} from "@workspace/donut";
import { db } from "./db";

const DAY = 86400 * 1000;

interface ResolvedScope {
  scope: "base" | "variant";
  scopeKey: string;
  baseItemId: string;
  displayName: string;
  variantHash: string | null;
  variantIds: number[];
}

export async function resolveScope(
  scopeKey: string,
): Promise<ResolvedScope | null> {
  const parsed = parseScopeKey(scopeKey);
  if (parsed.scope === "variant") {
    const rows = await db
      .select()
      .from(itemVariants)
      .where(eq(itemVariants.variantHash, parsed.value))
      .limit(1);
    if (rows.length === 0) return null;
    return {
      scope: "variant",
      scopeKey,
      baseItemId: rows[0].baseItemId,
      displayName: rows[0].displayName,
      variantHash: rows[0].variantHash,
      variantIds: [rows[0].id],
    };
  }
  const rows = await db
    .select()
    .from(itemVariants)
    .where(eq(itemVariants.baseItemId, parsed.value));
  if (rows.length === 0) return null;
  return {
    scope: "base",
    scopeKey,
    baseItemId: parsed.value,
    displayName: rows[0].displayName,
    variantHash: null,
    variantIds: rows.map((r) => r.id),
  };
}

interface SaleRow {
  unitPrice: number;
  quantity: number;
  totalPrice: number;
  soldAtMs: number;
  sellerUuid: string | null;
}

interface ListingRow {
  unitPrice: number;
  quantity: number;
}

async function loadSalesForVariants(
  variantIds: number[],
  sinceMs: number,
): Promise<SaleRow[]> {
  if (variantIds.length === 0) return [];
  const rows = await db
    .select({
      unitPrice: salesTransactions.unitPrice,
      quantity: salesTransactions.quantity,
      totalPrice: salesTransactions.totalPrice,
      soldAt: salesTransactions.soldAt,
      sellerUuid: salesTransactions.sellerUuid,
    })
    .from(salesTransactions)
    .where(
      and(
        inArray(salesTransactions.itemVariantId, variantIds),
        gte(salesTransactions.soldAt, new Date(sinceMs)),
      ),
    )
    .orderBy(desc(salesTransactions.soldAt));
  return rows.map((r) => ({
    unitPrice: Number(r.unitPrice),
    quantity: r.quantity,
    totalPrice: Number(r.totalPrice),
    soldAtMs: r.soldAt.getTime(),
    sellerUuid: r.sellerUuid,
  }));
}

async function loadListingsForVariants(
  variantIds: number[],
): Promise<ListingRow[]> {
  if (variantIds.length === 0) return [];
  const rows = await db
    .select({
      unitPrice: currentAuctionListings.unitPrice,
      quantity: currentAuctionListings.quantity,
    })
    .from(currentAuctionListings)
    .where(inArray(currentAuctionListings.itemVariantId, variantIds));
  return rows.map((r) => ({
    unitPrice: Number(r.unitPrice),
    quantity: r.quantity,
  }));
}

export interface ItemMetrics {
  latestSale: number | null;
  bestAsk: number | null;
  medianAsk: number | null;
  median1h: number | null;
  median24h: number | null;
  median7d: number | null;
  median30d: number | null;
  change24h: number | null;
  change7d: number | null;
  change30d: number | null;
  salesCount24h: number;
  soldQty24h: number;
  tradedValue24h: number;
  activeListings: number;
  listedQty: number;
  velocityPerHour: number | null;
  velocityPerDay: number | null;
  listingToSalesRatio: number | null;
  daysOfSupply: number | null;
  volatility: number | null;
  askPremiumPct: number | null;
  high24h: number | null;
  low24h: number | null;
  confidence: number;
}

function medianInWindow(
  sales: SaleRow[],
  fromMs: number,
  toMs: number,
): number | null {
  const prices = toNumbers(
    sales
      .filter((s) => s.soldAtMs >= fromMs && s.soldAtMs < toMs)
      .map((s) => s.unitPrice),
  );
  return medianOf(prices);
}

export function computeMetrics(
  sales: SaleRow[],
  listings: ListingRow[],
): ItemMetrics {
  const now = Date.now();
  const sortedByTime = [...sales].sort((a, b) => b.soldAtMs - a.soldAtMs);
  const latestSale = sortedByTime[0]?.unitPrice ?? null;

  const listingPrices = toNumbers(listings.map((l) => l.unitPrice));
  const bestAsk = listingPrices[0] ?? null;
  const medianAsk = medianOf(listingPrices);
  const listedQty = listings.reduce((a, l) => a + l.quantity, 0);

  const median1h = medianInWindow(sales, now - 3600 * 1000, now);
  const median24h = medianInWindow(sales, now - DAY, now);
  const median7d = medianInWindow(sales, now - 7 * DAY, now);
  const median30d = medianInWindow(sales, now - 30 * DAY, now);

  const prev24h = medianInWindow(sales, now - 2 * DAY, now - DAY);
  const prev7d = medianInWindow(sales, now - 14 * DAY, now - 7 * DAY);
  const prev30d = medianInWindow(sales, now - 60 * DAY, now - 30 * DAY);

  const sales24h = sales.filter((s) => s.soldAtMs >= now - DAY);
  const salesCount24h = sales24h.length;
  const soldQty24h = sales24h.reduce((a, s) => a + s.quantity, 0);
  const tradedValue24h = sales24h.reduce((a, s) => a + s.totalPrice, 0);

  const prices30d = toNumbers(
    sales.filter((s) => s.soldAtMs >= now - 30 * DAY).map((s) => s.unitPrice),
  );
  const mad = medianAbsoluteDeviation(prices30d);
  const med30 = medianOf(prices30d);
  const volatility =
    mad !== null && med30 !== null && med30 > 0 ? mad / med30 : null;

  const velocityPerDay = salesCount24h;
  const velocityPerHour = salesCount24h / 24;
  const activeListings = listings.length;
  const listingToSalesRatio =
    salesCount24h > 0 ? activeListings / salesCount24h : null;
  const daysOfSupply =
    soldQty24h > 0 ? listedQty / soldQty24h : null;
  const askPremiumPct =
    bestAsk !== null && median7d !== null && median7d > 0
      ? pctChange(bestAsk, median7d)
      : null;

  const newestAge = sortedByTime[0]
    ? now - sortedByTime[0].soldAtMs
    : null;
  const confidence = confidenceScore({
    sampleSize: sales.length,
    newestAgeMs: newestAge,
    expectedIntervals: 24,
    observedIntervals: new Set(
      sales
        .filter((s) => s.soldAtMs >= now - DAY)
        .map((s) => Math.floor(s.soldAtMs / (3600 * 1000))),
    ).size,
  });

  return {
    latestSale,
    bestAsk,
    medianAsk,
    median1h,
    median24h,
    median7d,
    median30d,
    change24h: pctChange(median24h, prev24h),
    change7d: pctChange(median7d, prev7d),
    change30d: pctChange(median30d, prev30d),
    salesCount24h,
    soldQty24h,
    tradedValue24h,
    activeListings,
    listedQty,
    velocityPerHour,
    velocityPerDay,
    listingToSalesRatio,
    daysOfSupply,
    volatility,
    askPremiumPct,
    high24h: prices30d.length ? Math.max(...toNumbers(sales24h.map((s) => s.unitPrice))) || null : null,
    low24h: sales24h.length ? Math.min(...toNumbers(sales24h.map((s) => s.unitPrice))) : null,
    confidence,
  };
}

export { loadSalesForVariants, loadListingsForVariants };
export type { SaleRow, ListingRow };
