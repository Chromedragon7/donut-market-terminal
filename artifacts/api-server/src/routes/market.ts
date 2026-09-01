import { Router, type IRouter } from "express";
import { desc } from "drizzle-orm";
import { db, syncRuns } from "@workspace/donut-data";
import { eq } from "drizzle-orm";
import {
  GetMarketOverviewResponse,
  GetMarketScreenerResponse,
  GetMarketScreenerQueryParams,
} from "@workspace/api-zod";
import { buildScopeSummaries, type ScopeSummary } from "../lib/scopes";

const router: IRouter = Router();

async function lastListingSyncAt(): Promise<string | null> {
  const rows = await db
    .select({ finishedAt: syncRuns.finishedAt })
    .from(syncRuns)
    .where(eq(syncRuns.jobType, "listings"))
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);
  return rows[0]?.finishedAt?.toISOString() ?? null;
}

async function collectionStartedAt(): Promise<string | null> {
  const rows = await db
    .select({ startedAt: syncRuns.startedAt })
    .from(syncRuns)
    .orderBy(syncRuns.startedAt)
    .limit(1);
  return rows[0]?.startedAt?.toISOString() ?? null;
}

function overviewRow(s: ScopeSummary): {
  scopeKey: string;
  baseItemId: string;
  displayName: string;
  latestSale: number | null;
  medianSale24h: number | null;
  bestAsk: number | null;
  change24h: number | null;
  change7d: number | null;
  volume24h: number;
  soldQty24h: number;
  activeListings: number;
  volatility: number | null;
  discountPct: number | null;
  confidence: number;
  spark: number[];
} {
  const m = s.metrics;
  const spark = s.sales
    .slice(0, 24)
    .reverse()
    .map((x) => x.unitPrice);
  return {
    scopeKey: s.scopeKey,
    baseItemId: s.baseItemId,
    displayName: s.displayName,
    latestSale: m.latestSale,
    medianSale24h: m.median24h,
    bestAsk: m.bestAsk,
    change24h: m.change24h,
    change7d: m.change7d,
    volume24h: m.tradedValue24h,
    soldQty24h: m.soldQty24h,
    activeListings: m.activeListings,
    volatility: m.volatility,
    discountPct: m.askPremiumPct,
    confidence: m.confidence,
    spark,
  };
}

router.get("/market/overview", async (_req, res) => {
  const summaries = await buildScopeSummaries("base");
  const lastUpdated = await lastListingSyncAt();
  const startedAt = await collectionStartedAt();

  const tradedValue24h = summaries.reduce(
    (a, s) => a + s.metrics.tradedValue24h,
    0,
  );
  const tradedValue7d = summaries.reduce(
    (a, s) =>
      a +
      s.sales
        .filter((x) => x.soldAtMs >= Date.now() - 7 * 86400 * 1000)
        .reduce((b, x) => b + x.totalPrice, 0),
    0,
  );
  const txCount24h = summaries.reduce(
    (a, s) => a + s.metrics.salesCount24h,
    0,
  );
  const soldQty24h = summaries.reduce((a, s) => a + s.metrics.soldQty24h, 0);
  const activeListings = summaries.reduce(
    (a, s) => a + s.metrics.activeListings,
    0,
  );

  const mostTraded = [...summaries]
    .sort((a, b) => b.metrics.tradedValue24h - a.metrics.tradedValue24h)
    .slice(0, 10)
    .map(overviewRow);
  const gainers = [...summaries]
    .filter((s) => (s.metrics.change24h ?? 0) > 0)
    .sort((a, b) => (b.metrics.change24h ?? 0) - (a.metrics.change24h ?? 0))
    .slice(0, 10)
    .map(overviewRow);
  const losers = [...summaries]
    .filter((s) => (s.metrics.change24h ?? 0) < 0)
    .sort((a, b) => (a.metrics.change24h ?? 0) - (b.metrics.change24h ?? 0))
    .slice(0, 10)
    .map(overviewRow);
  const mostVolatile = [...summaries]
    .filter((s) => s.metrics.volatility !== null)
    .sort((a, b) => (b.metrics.volatility ?? 0) - (a.metrics.volatility ?? 0))
    .slice(0, 10)
    .map(overviewRow);
  const biggestDiscounts = [...summaries]
    .filter((s) => s.metrics.askPremiumPct !== null)
    .sort(
      (a, b) => (a.metrics.askPremiumPct ?? 0) - (b.metrics.askPremiumPct ?? 0),
    )
    .slice(0, 10)
    .map(overviewRow);

  const lastUpdatedMs = lastUpdated ? Date.parse(lastUpdated) : null;
  const stale =
    lastUpdatedMs === null || Date.now() - lastUpdatedMs > 30 * 60 * 1000;

  const data = GetMarketOverviewResponse.parse({
    tradedValue24h,
    tradedValue7d,
    txCount24h,
    soldQty24h,
    activeListings,
    lastUpdated,
    stale,
    collectionStartedAt: startedAt,
    mostTraded,
    gainers,
    losers,
    mostVolatile,
    biggestDiscounts,
  });
  res.json(data);
});

router.get("/market/screener", async (req, res) => {
  const params = GetMarketScreenerQueryParams.parse(req.query);
  let summaries = await buildScopeSummaries(params.scope);

  if (params.search) {
    const q = params.search.toLowerCase();
    summaries = summaries.filter(
      (s) =>
        s.displayName.toLowerCase().includes(q) ||
        s.baseItemId.toLowerCase().includes(q),
    );
  }
  if (params.minVolume !== undefined) {
    summaries = summaries.filter(
      (s) => s.metrics.tradedValue24h >= (params.minVolume ?? 0),
    );
  }
  if (params.minSamples !== undefined) {
    summaries = summaries.filter(
      (s) => s.sales.length >= (params.minSamples ?? 0),
    );
  }

  const dir = params.sortDir === "asc" ? 1 : -1;
  const keyOf = (s: ScopeSummary): number => {
    switch (params.sortBy) {
      case "latestSale":
        return s.metrics.latestSale ?? 0;
      case "median24h":
        return s.metrics.median24h ?? 0;
      case "change24h":
        return s.metrics.change24h ?? 0;
      case "change7d":
        return s.metrics.change7d ?? 0;
      case "activeListings":
        return s.metrics.activeListings;
      case "volatility":
        return s.metrics.volatility ?? 0;
      case "confidence":
        return s.metrics.confidence;
      case "volume24h":
      default:
        return s.metrics.tradedValue24h;
    }
  };
  summaries.sort((a, b) => (keyOf(a) - keyOf(b)) * dir);

  const total = summaries.length;
  const start = (params.page - 1) * params.pageSize;
  const pageRows = summaries.slice(start, start + params.pageSize);

  const rows = pageRows.map((s) => ({
    scopeKey: s.scopeKey,
    baseItemId: s.baseItemId,
    displayName: s.displayName,
    scope: s.scope,
    bestAsk: s.metrics.bestAsk,
    latestSale: s.metrics.latestSale,
    median24h: s.metrics.median24h,
    change24h: s.metrics.change24h,
    change7d: s.metrics.change7d,
    volume24h: s.metrics.tradedValue24h,
    activeListings: s.metrics.activeListings,
    liquidity: s.metrics.velocityPerDay ?? 0,
    volatility: s.metrics.volatility,
    confidence: s.metrics.confidence,
    sampleCount: s.sales.length,
  }));

  const data = GetMarketScreenerResponse.parse({
    rows,
    total,
    page: params.page,
    pageSize: params.pageSize,
  });
  res.json(data);
});

export default router;
