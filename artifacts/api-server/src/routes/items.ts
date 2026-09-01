import { Router, type IRouter } from "express";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  currentAuctionListings,
  itemVariants,
  salesTransactions,
  resolveScope,
  loadSalesForVariants,
  loadListingsForVariants,
  computeMetrics,
} from "@workspace/donut-data";
import {
  baseScopeKey,
  variantScopeKey,
  buildCandles,
  deriveSignals,
  median as medianOf,
  toNumbers,
  medianAbsoluteDeviation,
} from "@workspace/donut";
import {
  GetItemDetailResponse,
  GetItemDetailParams,
  GetItemHistoryResponse,
  GetItemHistoryQueryParams,
  GetItemListingsResponse,
  GetItemTransactionsResponse,
  GetItemTransactionsQueryParams,
} from "@workspace/api-zod";
import { enchantsOf, trimOf, loreOf } from "../lib/serialize";

const router: IRouter = Router();

const INTERVAL_MS: Record<string, number> = {
  "5m": 5 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
};
const RANGE_MS: Record<string, number | null> = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 86400 * 1000,
  "30d": 30 * 86400 * 1000,
  "90d": 90 * 86400 * 1000,
  all: null,
};

const SIGNAL_LABELS: Record<string, { label: string; tone: string }> = {
  below_median: { label: "Below median", tone: "positive" },
  above_median: { label: "Above median", tone: "warning" },
  high_liquidity: { label: "High liquidity", tone: "positive" },
  low_sample_size: { label: "Low sample size", tone: "warning" },
  unusually_volatile: { label: "Unusually volatile", tone: "warning" },
};

router.get("/items/history", async (req, res) => {
  const params = GetItemHistoryQueryParams.parse(req.query);
  const resolved = await resolveScope(params.scopeKey);
  if (!resolved) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  const rangeMs = RANGE_MS[params.range];
  const since = rangeMs === null ? 0 : Date.now() - rangeMs;
  const sales = await loadSalesForVariants(resolved.variantIds, since);
  const listings = await loadListingsForVariants(resolved.variantIds);

  const intervalMs = INTERVAL_MS[params.interval];
  const rawCandles = buildCandles(
    sales.map((s) => ({
      soldAtMs: s.soldAtMs,
      unitPrice: s.unitPrice,
      quantity: s.quantity,
    })),
    intervalMs,
  );
  const candles = rawCandles.map((c, i) => {
    const prev = rawCandles[i - 1];
    return {
      t: new Date(c.bucketStart).toISOString(),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      median: c.median,
      volume: c.volume,
      txCount: c.count,
      gap: prev ? c.bucketStart - prev.bucketStart > intervalMs : false,
    };
  });

  const sortedListings = [...listings].sort((a, b) => a.unitPrice - b.unitPrice);
  let cumulative = 0;
  const depth = sortedListings.map((l) => {
    cumulative += l.quantity;
    return { unitPrice: l.unitPrice, cumulativeQty: cumulative };
  });

  const prices = sales.map((s) => s.unitPrice);
  const histogram: Array<{ from: number; to: number; count: number }> = [];
  if (prices.length > 0) {
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const bins = 12;
    const width = (max - min) / bins || 1;
    for (let i = 0; i < bins; i++) {
      const from = min + i * width;
      const to = i === bins - 1 ? max + 1 : min + (i + 1) * width;
      histogram.push({
        from,
        to,
        count: prices.filter((p) => p >= from && p < to).length,
      });
    }
  }

  const data = GetItemHistoryResponse.parse({
    interval: params.interval,
    range: params.range,
    candles,
    depth,
    histogram,
  });
  res.json(data);
});

router.get("/items/transactions", async (req, res) => {
  const params = GetItemTransactionsQueryParams.parse(req.query);
  const resolved = await resolveScope(params.scopeKey);
  if (!resolved) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (resolved.variantIds.length === 0) {
    res.json([]);
    return;
  }
  const rows = await db
    .select({
      id: salesTransactions.id,
      baseItemId: itemVariants.baseItemId,
      displayName: itemVariants.displayName,
      variantHash: itemVariants.variantHash,
      sellerName: salesTransactions.sellerName,
      sellerUuid: salesTransactions.sellerUuid,
      quantity: salesTransactions.quantity,
      totalPrice: salesTransactions.totalPrice,
      unitPrice: salesTransactions.unitPrice,
      soldAt: salesTransactions.soldAt,
      enchantmentsJson: itemVariants.enchantmentsJson,
    })
    .from(salesTransactions)
    .innerJoin(
      itemVariants,
      eq(salesTransactions.itemVariantId, itemVariants.id),
    )
    .where(inArray(salesTransactions.itemVariantId, resolved.variantIds))
    .orderBy(desc(salesTransactions.soldAt))
    .limit(params.pageSize)
    .offset((params.page - 1) * params.pageSize);

  const data = GetItemTransactionsResponse.parse(
    rows.map((r) => ({
      id: r.id,
      scopeKey:
        resolved.scope === "variant"
          ? variantScopeKey(r.variantHash)
          : baseScopeKey(r.baseItemId),
      variantScopeKey: variantScopeKey(r.variantHash),
      baseItemId: r.baseItemId,
      displayName: r.displayName,
      sellerName: r.sellerName,
      sellerUuid: r.sellerUuid,
      quantity: r.quantity,
      totalPrice: Number(r.totalPrice),
      unitPrice: Number(r.unitPrice),
      soldAt: r.soldAt.toISOString(),
      enchants: enchantsOf(r.enchantmentsJson),
    })),
  );
  res.json(data);
});

router.get("/items/:scopeKey/listings", async (req, res) => {
  const { scopeKey } = GetItemDetailParams.parse(req.params);
  const resolved = await resolveScope(scopeKey);
  if (!resolved) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (resolved.variantIds.length === 0) {
    res.json([]);
    return;
  }
  const rows = await db
    .select({
      id: currentAuctionListings.id,
      baseItemId: itemVariants.baseItemId,
      displayName: itemVariants.displayName,
      variantHash: itemVariants.variantHash,
      sellerName: currentAuctionListings.sellerName,
      sellerUuid: currentAuctionListings.sellerUuid,
      quantity: currentAuctionListings.quantity,
      totalPrice: currentAuctionListings.totalPrice,
      unitPrice: currentAuctionListings.unitPrice,
      timeLeftMs: currentAuctionListings.timeLeftMs,
      approxExpiresAt: currentAuctionListings.approxExpiresAt,
      enchantmentsJson: itemVariants.enchantmentsJson,
      trimJson: itemVariants.trimJson,
      loreJson: itemVariants.loreJson,
    })
    .from(currentAuctionListings)
    .innerJoin(
      itemVariants,
      eq(currentAuctionListings.itemVariantId, itemVariants.id),
    )
    .where(inArray(currentAuctionListings.itemVariantId, resolved.variantIds))
    .orderBy(asc(currentAuctionListings.unitPrice));

  const data = GetItemListingsResponse.parse(
    rows.map((r) => {
      const trim = trimOf(r.trimJson);
      return {
        id: r.id,
        scopeKey:
          resolved.scope === "variant"
            ? variantScopeKey(r.variantHash)
            : baseScopeKey(r.baseItemId),
        variantScopeKey: variantScopeKey(r.variantHash),
        baseItemId: r.baseItemId,
        displayName: r.displayName,
        sellerName: r.sellerName,
        sellerUuid: r.sellerUuid,
        quantity: r.quantity,
        totalPrice: Number(r.totalPrice),
        unitPrice: Number(r.unitPrice),
        timeLeftMs: r.timeLeftMs,
        approxExpiresAt: r.approxExpiresAt?.toISOString() ?? null,
        enchants: enchantsOf(r.enchantmentsJson),
        trimMaterial: trim.material,
        trimPattern: trim.pattern,
        lore: loreOf(r.loreJson),
      };
    }),
  );
  res.json(data);
});

router.get("/items/:scopeKey", async (req, res) => {
  const { scopeKey } = GetItemDetailParams.parse(req.params);
  const resolved = await resolveScope(scopeKey);
  if (!resolved) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  const since = Date.now() - 30 * 86400 * 1000;
  const sales = await loadSalesForVariants(resolved.variantIds, since);
  const listings = await loadListingsForVariants(resolved.variantIds);
  const metrics = computeMetrics(sales, listings);

  const prices30d = toNumbers(sales.map((s) => s.unitPrice));
  const mad = medianAbsoluteDeviation([...prices30d].sort((a, b) => a - b));
  const med = medianOf([...prices30d].sort((a, b) => a - b));
  const madRatio = mad !== null && med !== null && med > 0 ? mad / med : null;
  const signals = deriveSignals({
    bestAsk: metrics.bestAsk,
    recentMedianSale: metrics.median7d,
    salesCount: sales.length,
    madRatio,
  }).map((sig) => ({
    label: SIGNAL_LABELS[sig]?.label ?? sig,
    detail: sig.replace(/_/g, " "),
    tone: SIGNAL_LABELS[sig]?.tone ?? "neutral",
  }));

  let variants: Array<Record<string, unknown>> | undefined;
  if (resolved.scope === "base") {
    const variantRows = await db
      .select()
      .from(itemVariants)
      .where(eq(itemVariants.baseItemId, resolved.baseItemId));
    variants = variantRows.map((v) => {
      const trim = trimOf(v.trimJson);
      return {
        scopeKey: variantScopeKey(v.variantHash),
        baseItemId: v.baseItemId,
        displayName: v.displayName,
        variantHash: v.variantHash,
        enchants: enchantsOf(v.enchantmentsJson),
        trimMaterial: trim.material,
        trimPattern: trim.pattern,
        lore: loreOf(v.loreJson),
      };
    });
  }

  const data = GetItemDetailResponse.parse({
    scope: resolved.scope,
    scopeKey: resolved.scopeKey,
    baseItemId: resolved.baseItemId,
    displayName: resolved.displayName,
    baseScopeKey: baseScopeKey(resolved.baseItemId),
    mixedVariants: resolved.scope === "base" && (variants?.length ?? 0) > 1,
    metrics,
    signals,
    variants,
  });
  res.json(data);
});

export default router;
