import { eq, sql } from "drizzle-orm";
import {
  currentAuctionListings,
  itemVariants,
  leaderboardEntries,
  leaderboardSnapshots,
  listingMarketSnapshots,
  salesTransactions,
  syncRuns,
  watchedPlayers,
  type InsertSalesTransaction,
} from "@workspace/db";
import {
  LEADERBOARD_CATEGORIES,
  type LeaderboardCategory,
  baseScopeKey,
  config,
  createDonutClient,
  normalizeItem,
  parseLeaderboardValue,
  quantile,
  toNumbers,
  transactionDedupeHash,
  unitPrice,
} from "@workspace/donut";
import { db } from "./db";
import { withAdvisoryLock } from "./db";
import {
  insertTransactionsIgnoreConflicts,
  nextSnapshotId,
  upsertVariant,
} from "./repo";
import { recomputeAffectedScopes } from "./rollups";
import { refreshPlayer } from "./player";

export interface SyncResult {
  ran: boolean;
  status: "complete" | "partial" | "failed" | "skipped";
  recordsSeen: number;
  recordsInserted: number;
  pagesFetched: number;
  upstreamRequests: number;
  error?: string;
}

function skipped(): SyncResult {
  return {
    ran: false,
    status: "skipped",
    recordsSeen: 0,
    recordsInserted: 0,
    pagesFetched: 0,
    upstreamRequests: 0,
  };
}

async function startRun(jobType: string): Promise<number> {
  const rows = await db
    .insert(syncRuns)
    .values({ jobType, status: "running" })
    .returning({ id: syncRuns.id });
  return rows[0].id;
}

async function finishRun(
  id: number,
  result: SyncResult,
): Promise<void> {
  await db
    .update(syncRuns)
    .set({
      finishedAt: new Date(),
      status: result.status === "failed" ? "failed" : "succeeded",
      complete: result.status === "complete" ? "complete" : "partial",
      upstreamRequestCount: result.upstreamRequests,
      pagesFetched: result.pagesFetched,
      recordsSeen: result.recordsSeen,
      recordsInserted: result.recordsInserted,
      errorSummary: result.error ?? null,
    })
    .where(eq(syncRuns.id, id));
}

export async function runTransactionsSync(): Promise<SyncResult> {
  const result = await withAdvisoryLock("sync:transactions", async () => {
    const client = createDonutClient();
    const runId = await startRun("transactions");
    const out: SyncResult = {
      ran: true,
      status: "complete",
      recordsSeen: 0,
      recordsInserted: 0,
      pagesFetched: 0,
      upstreamRequests: 0,
    };
    const affected = new Set<string>();
    try {
      for (let page = 1; page <= 10; page += 1) {
        const resp = await client.auctionTransactions(page);
        out.pagesFetched = page;
        const items = resp.result ?? [];
        if (items.length === 0) break;
        const batchCounts = new Map<string, number>();
        const values: InsertSalesTransaction[] = [];
        for (const t of items) {
          if (!t.item || t.price === undefined) continue;
          out.recordsSeen += 1;
          const normalized = normalizeItem(t.item);
          const variantId = await upsertVariant(normalized);
          const soldAtMs = t.unixMillisDateSold ?? Date.now();
          const total = String(t.price);
          const key = `${soldAtMs}|${t.seller?.uuid ?? ""}|${normalized.variantHash}|${normalized.quantity}|${total}`;
          const occ = batchCounts.get(key) ?? 0;
          batchCounts.set(key, occ + 1);
          const dedupeHash = transactionDedupeHash({
            soldAtMs,
            sellerUuid: t.seller?.uuid ?? "",
            sellerName: t.seller?.name ?? "",
            variantHash: normalized.variantHash,
            quantity: normalized.quantity,
            totalPrice: total,
            occurrence: occ,
          });
          values.push({
            dedupeHash,
            itemVariantId: variantId,
            sellerName: t.seller?.name ?? null,
            sellerUuid: t.seller?.uuid ?? null,
            quantity: normalized.quantity,
            totalPrice: total,
            unitPrice: unitPrice(total, normalized.quantity),
            soldAt: new Date(soldAtMs),
            rawJson: t,
          });
          affected.add(baseScopeKey(normalized.baseItemId));
          affected.add(`variant:${normalized.variantHash}`);
        }
        out.recordsInserted += await insertTransactionsIgnoreConflicts(values);
      }
      if (affected.size > 0) await recomputeAffectedScopes(affected);
    } catch (err) {
      out.status = "partial";
      out.error = errMessage(err);
    }
    out.upstreamRequests = client.stats.upstreamRequests;
    await finishRun(runId, out);
    return out;
  });
  return result ?? skipped();
}

export async function runListingsSync(): Promise<SyncResult> {
  const result = await withAdvisoryLock("sync:listings", async () => {
    const client = createDonutClient();
    const runId = await startRun("listings");
    const out: SyncResult = {
      ran: true,
      status: "complete",
      recordsSeen: 0,
      recordsInserted: 0,
      pagesFetched: 0,
      upstreamRequests: 0,
    };
    const snapshotId = nextSnapshotId();
    const staged: Array<typeof currentAuctionListings.$inferInsert> = [];
    const seenFingerprints = new Set<string>();
    try {
      for (let page = 1; page <= config.auctionMaxPages; page += 1) {
        const resp = await client.auctionList(page);
        out.pagesFetched = page;
        const items = resp.result ?? [];
        if (items.length === 0) break;
        const fingerprint = JSON.stringify(
          items.map((i) => `${i.item?.id}:${i.price}:${i.seller?.uuid}`),
        );
        if (seenFingerprints.has(fingerprint)) break;
        seenFingerprints.add(fingerprint);
        for (const l of items) {
          if (!l.item || l.price === undefined) continue;
          out.recordsSeen += 1;
          const normalized = normalizeItem(l.item);
          const variantId = await upsertVariant(normalized);
          const total = String(l.price);
          staged.push({
            snapshotId,
            itemVariantId: variantId,
            sellerName: l.seller?.name ?? null,
            sellerUuid: l.seller?.uuid ?? null,
            quantity: normalized.quantity,
            totalPrice: total,
            unitPrice: unitPrice(total, normalized.quantity),
            timeLeftMs: l.time_left ?? null,
            approxExpiresAt:
              l.time_left != null
                ? new Date(Date.now() + l.time_left)
                : null,
            rawJson: l,
          });
        }
        if (page >= config.auctionMaxPages) out.status = "partial";
      }

      if (staged.length > 0) {
        await db.transaction(async (tx) => {
          await tx.delete(currentAuctionListings);
          for (let i = 0; i < staged.length; i += 500) {
            await tx
              .insert(currentAuctionListings)
              .values(staged.slice(i, i + 500));
          }
        });
        out.recordsInserted = staged.length;
        await writeListingAggregates(snapshotId);
      }
    } catch (err) {
      out.status = "partial";
      out.error = errMessage(err);
    }
    out.upstreamRequests = client.stats.upstreamRequests;
    await finishRun(runId, out);
    return out;
  });
  return result ?? skipped();
}

async function writeListingAggregates(snapshotId: number): Promise<void> {
  const rows = await db
    .select({
      baseItemId: itemVariants.baseItemId,
      variantId: itemVariants.id,
      variantHash: itemVariants.variantHash,
      unitPrice: currentAuctionListings.unitPrice,
      quantity: currentAuctionListings.quantity,
    })
    .from(currentAuctionListings)
    .innerJoin(
      itemVariants,
      eq(currentAuctionListings.itemVariantId, itemVariants.id),
    );

  const bucketTs = new Date();
  const byBase = new Map<string, { prices: number[]; qty: number; count: number }>();
  const byVariant = new Map<
    string,
    { baseItemId: string; variantId: number; prices: number[]; qty: number; count: number }
  >();
  for (const r of rows) {
    const price = Number(r.unitPrice);
    const b = byBase.get(r.baseItemId) ?? { prices: [], qty: 0, count: 0 };
    b.prices.push(price);
    b.qty += r.quantity;
    b.count += 1;
    byBase.set(r.baseItemId, b);

    const v = byVariant.get(r.variantHash) ?? {
      baseItemId: r.baseItemId,
      variantId: r.variantId,
      prices: [],
      qty: 0,
      count: 0,
    };
    v.prices.push(price);
    v.qty += r.quantity;
    v.count += 1;
    byVariant.set(r.variantHash, v);
  }

  const aggValues: Array<typeof listingMarketSnapshots.$inferInsert> = [];
  for (const [baseItemId, agg] of byBase) {
    aggValues.push(
      aggregateRow(bucketTs, baseItemId, null, null, agg, snapshotId),
    );
  }
  for (const [variantHash, agg] of byVariant) {
    aggValues.push(
      aggregateRow(
        bucketTs,
        agg.baseItemId,
        agg.variantId,
        variantHash,
        agg,
        snapshotId,
      ),
    );
  }
  for (let i = 0; i < aggValues.length; i += 500) {
    await db
      .insert(listingMarketSnapshots)
      .values(aggValues.slice(i, i + 500))
      .onConflictDoNothing();
  }
}

function aggregateRow(
  bucketTs: Date,
  baseItemId: string,
  variantId: number | null,
  variantHash: string | null,
  agg: { prices: number[]; qty: number; count: number },
  snapshotId: number,
): typeof listingMarketSnapshots.$inferInsert {
  const sorted = toNumbers(agg.prices);
  const weighted =
    agg.qty > 0
      ? agg.prices.reduce((a, p) => a + p, 0) / agg.prices.length
      : null;
  return {
    bucketTs,
    baseItemId,
    variantId,
    variantHash,
    activeListingCount: agg.count,
    listedQuantity: agg.qty,
    minAsk: ns(sorted[0]),
    p25Ask: ns(quantile(sorted, 0.25)),
    medianAsk: ns(quantile(sorted, 0.5)),
    avgAsk: ns(weighted),
    p75Ask: ns(quantile(sorted, 0.75)),
    maxAsk: ns(sorted[sorted.length - 1]),
    weightedAvgAsk: ns(weighted),
    sourceSnapshotId: snapshotId,
  };
}

export async function runLeaderboardsSync(): Promise<SyncResult> {
  const result = await withAdvisoryLock("sync:leaderboards", async () => {
    const client = createDonutClient();
    const runId = await startRun("leaderboards");
    const out: SyncResult = {
      ran: true,
      status: "complete",
      recordsSeen: 0,
      recordsInserted: 0,
      pagesFetched: 0,
      upstreamRequests: 0,
    };
    try {
      for (const category of LEADERBOARD_CATEGORIES) {
        await syncCategory(client, category, out, runId);
      }
    } catch (err) {
      out.status = "partial";
      out.error = errMessage(err);
    }
    out.upstreamRequests = client.stats.upstreamRequests;
    await finishRun(runId, out);
    return out;
  });
  return result ?? skipped();
}

async function syncCategory(
  client: ReturnType<typeof createDonutClient>,
  category: LeaderboardCategory,
  out: SyncResult,
  runId: number,
): Promise<void> {
  const snapRows = await db
    .insert(leaderboardSnapshots)
    .values({ category, syncRunId: runId, status: "complete" })
    .returning({ id: leaderboardSnapshots.id });
  const snapshotId = snapRows[0].id;
  let pages = 0;
  let rank = 0;
  let status: "complete" | "partial" = "complete";
  for (let page = 1; page <= config.leaderboardMaxPages; page += 1) {
    const resp = await client.leaderboard(category, page);
    out.pagesFetched += 1;
    pages += 1;
    const entries = resp.result ?? [];
    if (entries.length === 0) break;
    const values: Array<typeof leaderboardEntries.$inferInsert> = [];
    for (const e of entries) {
      rank += 1;
      out.recordsSeen += 1;
      const parsed = parseLeaderboardValue(e.value ?? undefined);
      values.push({
        snapshotId,
        category,
        rank,
        username: e.username ?? null,
        uuid: e.uuid ?? null,
        rawValue: e.value ?? null,
        parsedNumeric: parsed.numeric === null ? null : String(parsed.numeric),
        parsedDurationSeconds: parsed.durationSeconds,
      });
    }
    await db.insert(leaderboardEntries).values(values).onConflictDoNothing();
    out.recordsInserted += values.length;
    if (page >= config.leaderboardMaxPages) status = "partial";
  }
  await db
    .update(leaderboardSnapshots)
    .set({ pageCount: pages, status })
    .where(eq(leaderboardSnapshots.id, snapshotId));
}

export async function runWatchedPlayersSync(): Promise<SyncResult> {
  const result = await withAdvisoryLock("sync:watched-players", async () => {
    const runId = await startRun("watched-players");
    const out: SyncResult = {
      ran: true,
      status: "complete",
      recordsSeen: 0,
      recordsInserted: 0,
      pagesFetched: 0,
      upstreamRequests: 0,
    };
    try {
      const watched = await db.select().from(watchedPlayers);
      for (const w of watched) {
        out.recordsSeen += 1;
        try {
          await refreshPlayer(w.username, true);
          out.recordsInserted += 1;
          out.upstreamRequests += 2;
        } catch (err) {
          out.error = errMessage(err);
          out.status = "partial";
        }
      }
    } catch (err) {
      out.status = "partial";
      out.error = errMessage(err);
    }
    await finishRun(runId, out);
    return out;
  });
  return result ?? skipped();
}

export async function runMarketRollup(): Promise<SyncResult> {
  const result = await withAdvisoryLock("rollup:market", async () => {
    const runId = await startRun("rollups");
    const out: SyncResult = {
      ran: true,
      status: "complete",
      recordsSeen: 0,
      recordsInserted: 0,
      pagesFetched: 0,
      upstreamRequests: 0,
    };
    try {
      const { recomputeAllScopes } = await import("./rollups");
      out.recordsInserted = await recomputeAllScopes();
    } catch (err) {
      out.status = "partial";
      out.error = errMessage(err);
    }
    await finishRun(runId, out);
    return out;
  });
  return result ?? skipped();
}

export async function runCleanup(): Promise<SyncResult> {
  const result = await withAdvisoryLock("cleanup:data", async () => {
    const runId = await startRun("cleanup");
    const out: SyncResult = {
      ran: true,
      status: "complete",
      recordsSeen: 0,
      recordsInserted: 0,
      pagesFetched: 0,
      upstreamRequests: 0,
    };
    try {
      const cutoff = new Date(
        Date.now() - config.rawListingRetentionDays * 86400 * 1000,
      );
      await db
        .delete(listingMarketSnapshots)
        .where(sql`${listingMarketSnapshots.bucketTs} < ${cutoff}`);
    } catch (err) {
      out.status = "partial";
      out.error = errMessage(err);
    }
    await finishRun(runId, out);
    return out;
  });
  return result ?? skipped();
}

export async function runSyncAll(): Promise<Record<string, SyncResult>> {
  return {
    transactions: await runTransactionsSync(),
    listings: await runListingsSync(),
    leaderboards: await runLeaderboardsSync(),
    rollup: await runMarketRollup(),
  };
}

function ns(v: number | null | undefined): string | null {
  return v === null || v === undefined || !Number.isFinite(v)
    ? null
    : String(v);
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Unknown error";
}
