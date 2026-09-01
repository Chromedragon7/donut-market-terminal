import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import {
  db,
  itemVariants,
  salesTransactions,
  currentAuctionListings,
  syncRuns,
} from "@workspace/donut-data";
import { eq, desc } from "drizzle-orm";
import { hasApiKey } from "@workspace/donut";
import { GetSetupStatusResponse } from "@workspace/api-zod";
import { adminConfigured } from "../lib/session";

const router: IRouter = Router();

async function lastRunAt(jobType: string): Promise<string | null> {
  const rows = await db
    .select({ finishedAt: syncRuns.finishedAt })
    .from(syncRuns)
    .where(eq(syncRuns.jobType, jobType))
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);
  return rows[0]?.finishedAt?.toISOString() ?? null;
}

router.get("/setup-status", async (_req, res) => {
  const databaseConfigured = Boolean(process.env.DATABASE_URL);

  if (!databaseConfigured) {
    const data = GetSetupStatusResponse.parse({
      apiKeyConfigured: hasApiKey(),
      databaseConfigured: false,
      adminConfigured: adminConfigured(),
      hasData: false,
      stale: true,
      lastTransactionSyncAt: null,
      lastListingSyncAt: null,
      lastLeaderboardSyncAt: null,
      collectionStartedAt: null,
      transactionCount: 0,
      listingCount: 0,
      itemCount: 0,
    });
    res.json(data);
    return;
  }

  const [variantCount] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(itemVariants);
  const [txCount] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(salesTransactions);
  const [listingCount] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(currentAuctionListings);

  const lastTx = await lastRunAt("transactions");
  const lastListing = await lastRunAt("listings");
  const lastLeaderboard = await lastRunAt("leaderboards");

  const firstRun = await db
    .select({ startedAt: syncRuns.startedAt })
    .from(syncRuns)
    .orderBy(syncRuns.startedAt)
    .limit(1);

  const itemCount = variantCount?.c ?? 0;
  const transactionCount = txCount?.c ?? 0;
  const listings = listingCount?.c ?? 0;
  const hasData = transactionCount > 0 || listings > 0;
  const lastListingMs = lastListing ? Date.parse(lastListing) : null;
  const stale =
    lastListingMs === null || Date.now() - lastListingMs > 30 * 60 * 1000;

  const data = GetSetupStatusResponse.parse({
    apiKeyConfigured: hasApiKey(),
    databaseConfigured,
    adminConfigured: adminConfigured(),
    hasData,
    stale,
    lastTransactionSyncAt: lastTx,
    lastListingSyncAt: lastListing,
    lastLeaderboardSyncAt: lastLeaderboard,
    collectionStartedAt: firstRun[0]?.startedAt?.toISOString() ?? null,
    transactionCount,
    listingCount: listings,
    itemCount,
  });
  res.json(data);
});

export default router;
