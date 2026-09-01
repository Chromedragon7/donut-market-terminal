import { Router, type IRouter } from "express";
import { desc, eq, sql } from "drizzle-orm";
import {
  db,
  syncRuns,
  itemVariants,
  salesTransactions,
  currentAuctionListings,
  leaderboardEntries,
  players,
  runTransactionsSync,
  runListingsSync,
  runLeaderboardsSync,
  runMarketRollup,
  runCleanup,
  runSyncAll,
  addWatchedPlayer,
  removeWatchedPlayer,
} from "@workspace/donut-data";
import { watchedPlayers } from "@workspace/db";
import { config, hasApiKey } from "@workspace/donut";
import {
  AdminLoginBody,
  AdminLoginResponse,
  AdminLogoutResponse,
  GetAdminStatusResponse,
  TriggerSyncBody,
  TriggerSyncResponse,
  GetWatchedPlayersResponse,
  AddWatchedPlayerBody,
  AddWatchedPlayerResponse,
  RemoveWatchedPlayerParams,
  RemoveWatchedPlayerResponse,
  PreviewImportBody,
  PreviewImportResponse,
  CommitImportBody,
  CommitImportResponse,
} from "@workspace/api-zod";
import {
  adminConfigured,
  clearSession,
  issueSession,
  verifyPassword,
} from "../lib/session";
import { requireAdmin } from "../middlewares/admin";
import { rateLimit } from "../middlewares/rate-limit";

const router: IRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  keyPrefix: "admin-login",
});

router.post("/admin/login", loginLimiter, (req, res) => {
  const body = AdminLoginBody.parse(req.body);
  if (!adminConfigured()) {
    res.status(503).json({ error: "Admin password not configured" });
    return;
  }
  if (!verifyPassword(body.password)) {
    res.status(401).json(AdminLoginResponse.parse({ authenticated: false }));
    return;
  }
  issueSession(res);
  res.json(AdminLoginResponse.parse({ authenticated: true }));
});

router.post("/admin/logout", (_req, res) => {
  clearSession(res);
  res.json(AdminLogoutResponse.parse({ ok: true }));
});

async function lastRun(jobType: string) {
  const rows = await db
    .select()
    .from(syncRuns)
    .where(eq(syncRuns.jobType, jobType))
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);
  return rows[0] ?? null;
}

router.get("/admin/status", requireAdmin, async (_req, res) => {
  if (!process.env.DATABASE_URL) {
    const data = GetAdminStatusResponse.parse({
      apiKeyConfigured: hasApiKey(),
      databaseConfigured: false,
      requestsPerMinute: config.softRateLimitPerMin,
      requestConcurrency: config.maxConcurrency,
      orderDataSource: config.orderDataSource,
      collectionStartedAt: null,
      collectors: [
        "transactions",
        "listings",
        "leaderboards",
        "rollups",
      ].map((job) => ({
        job,
        status: "never_run",
        lastRunAt: null,
        lastFinishedAt: null,
        complete: null,
        recordsInserted: null,
        pagesFetched: null,
        upstreamRequests: null,
        errorSummary: null,
      })),
      tableCounts: [],
    });
    res.json(data);
    return;
  }

  const jobs = ["transactions", "listings", "leaderboards", "rollups"];
  const collectors = await Promise.all(
    jobs.map(async (job) => {
      const run = await lastRun(job);
      return {
        job,
        status: run?.status ?? "never_run",
        lastRunAt: run?.startedAt?.toISOString() ?? null,
        lastFinishedAt: run?.finishedAt?.toISOString() ?? null,
        complete: run ? run.complete === "complete" : null,
        recordsInserted: run?.recordsInserted ?? null,
        pagesFetched: run?.pagesFetched ?? null,
        upstreamRequests: run?.upstreamRequestCount ?? null,
        errorSummary: run?.errorSummary ?? null,
      };
    }),
  );

  const counts = await Promise.all(
    (
      [
        ["item_variants", itemVariants],
        ["sales_transactions", salesTransactions],
        ["current_auction_listings", currentAuctionListings],
        ["leaderboard_entries", leaderboardEntries],
        ["players", players],
      ] as const
    ).map(async ([table, tbl]) => {
      const [{ c } = { c: 0 }] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(tbl);
      return { table, rows: c };
    }),
  );

  const firstRun = await db
    .select({ startedAt: syncRuns.startedAt })
    .from(syncRuns)
    .orderBy(syncRuns.startedAt)
    .limit(1);

  const data = GetAdminStatusResponse.parse({
    apiKeyConfigured: hasApiKey(),
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    requestsPerMinute: config.softRateLimitPerMin,
    requestConcurrency: config.maxConcurrency,
    orderDataSource: config.orderDataSource,
    collectionStartedAt: firstRun[0]?.startedAt?.toISOString() ?? null,
    collectors,
    tableCounts: counts,
  });
  res.json(data);
});

router.post("/admin/sync", requireAdmin, async (req, res) => {
  const body = TriggerSyncBody.parse(req.body);
  if (body.job !== "cleanup" && !hasApiKey()) {
    res.status(503).json({ error: "DONUTSMP_API_KEY is not configured" });
    return;
  }
  try {
    if (body.job === "all") {
      const results = await runSyncAll();
      const totalInserted = Object.values(results).reduce(
        (a, r) => a + r.recordsInserted,
        0,
      );
      const totalPages = Object.values(results).reduce(
        (a, r) => a + r.pagesFetched,
        0,
      );
      const totalReq = Object.values(results).reduce(
        (a, r) => a + r.upstreamRequests,
        0,
      );
      res.json(
        TriggerSyncResponse.parse({
          job: "all",
          status: "complete",
          recordsInserted: totalInserted,
          pagesFetched: totalPages,
          upstreamRequests: totalReq,
          complete: true,
          errorSummary: null,
        }),
      );
      return;
    }
    const runner =
      body.job === "transactions"
        ? runTransactionsSync
        : body.job === "listings"
          ? runListingsSync
          : body.job === "leaderboards"
            ? runLeaderboardsSync
            : body.job === "cleanup"
              ? runCleanup
              : runMarketRollup;
    const result = await runner();
    res.json(
      TriggerSyncResponse.parse({
        job: body.job,
        status: result.status,
        recordsInserted: result.recordsInserted,
        pagesFetched: result.pagesFetched,
        upstreamRequests: result.upstreamRequests,
        complete: result.status === "complete",
        errorSummary: result.error ?? null,
      }),
    );
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Sync failed",
    });
  }
});

router.get("/admin/watched-players", requireAdmin, async (_req, res) => {
  const rows = await db.select().from(watchedPlayers);
  const data = GetWatchedPlayersResponse.parse(
    rows.map((r) => ({
      username: r.username,
      uuid: null,
      addedAt: r.createdAt.toISOString(),
    })),
  );
  res.json(data);
});

router.post("/admin/watched-players", requireAdmin, async (req, res) => {
  const body = AddWatchedPlayerBody.parse(req.body);
  await addWatchedPlayer(body.username);
  const rows = await db
    .select()
    .from(watchedPlayers)
    .where(eq(watchedPlayers.normalizedUsername, body.username.toLowerCase()))
    .limit(1);
  const data = AddWatchedPlayerResponse.parse({
    username: rows[0]?.username ?? body.username,
    uuid: null,
    addedAt: rows[0]?.createdAt?.toISOString() ?? null,
  });
  res.json(data);
});

router.delete(
  "/admin/watched-players/:username",
  requireAdmin,
  async (req, res) => {
    const { username } = RemoveWatchedPlayerParams.parse(req.params);
    await removeWatchedPlayer(username);
    res.json(RemoveWatchedPlayerResponse.parse({ ok: true }));
  },
);

function validateImport(rows: Array<{
  itemId: string;
  quantity: number;
  totalPrice: number;
  soldAt: string;
}>): { errors: Array<{ row: number; error: string }> } {
  const errors: Array<{ row: number; error: string }> = [];
  rows.forEach((r, i) => {
    if (!r.itemId || r.itemId.trim() === "")
      errors.push({ row: i + 1, error: "itemId is required" });
    if (!Number.isFinite(r.quantity) || r.quantity <= 0)
      errors.push({ row: i + 1, error: "quantity must be > 0" });
    if (!Number.isFinite(r.totalPrice) || r.totalPrice < 0)
      errors.push({ row: i + 1, error: "totalPrice must be >= 0" });
    if (Number.isNaN(Date.parse(r.soldAt)))
      errors.push({ row: i + 1, error: "soldAt must be a valid date" });
  });
  return { errors };
}

router.post("/admin/import/preview", requireAdmin, (req, res) => {
  const body = PreviewImportBody.parse(req.body);
  const { errors } = validateImport(body.rows);
  const data = PreviewImportResponse.parse({
    rowsRead: body.rows.length,
    accepted: body.rows.length - errors.length,
    rejected: errors.length,
    duplicates: 0,
    committed: false,
    errors,
  });
  res.json(data);
});

router.post("/admin/import/commit", requireAdmin, async (req, res) => {
  const body = CommitImportBody.parse(req.body);
  const { errors } = validateImport(body.rows);
  const validRows = body.rows.filter((_r, i) =>
    errors.every((e) => e.row !== i + 1),
  );

  const { upsertVariant, insertTransactionsIgnoreConflicts } = await import(
    "@workspace/donut-data"
  );
  const { transactionDedupeHash, normalizeItem, unitPrice } = await import(
    "@workspace/donut"
  );

  function tryParse(value: string | undefined): unknown {
    if (!value) return undefined;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  }

  let inserted = 0;
  let occurrence = 0;
  for (const row of validRows) {
    const enchObj = tryParse(row.enchantsJson);
    const trimObj = tryParse(row.trimJson);
    const loreArr = tryParse(row.loreJson);
    const contentsArr = tryParse(row.contentsJson);
    const normalized = normalizeItem({
      id: row.itemId,
      display_name: row.displayName ?? row.itemId,
      count: row.quantity,
      enchants:
        enchObj && typeof enchObj === "object"
          ? { enchantments: { levels: enchObj as Record<string, number> } }
          : undefined,
      trim:
        trimObj && typeof trimObj === "object"
          ? (trimObj as { material?: string; pattern?: string })
          : undefined,
      lore: Array.isArray(loreArr) ? (loreArr as string[]) : undefined,
      contents: Array.isArray(contentsArr)
        ? (contentsArr as Array<{ id?: string }>)
        : undefined,
    });
    const variantId = await upsertVariant(normalized);
    const unit = unitPrice(row.totalPrice, row.quantity);
    const dedupe = transactionDedupeHash({
      variantHash: normalized.variantHash,
      sellerUuid: row.sellerUuid ?? "",
      sellerName: row.sellerName ?? "",
      quantity: row.quantity,
      totalPrice: String(row.totalPrice),
      soldAtMs: Date.parse(row.soldAt),
      occurrence: occurrence++,
    });
    const n = await insertTransactionsIgnoreConflicts([
      {
        dedupeHash: dedupe,
        itemVariantId: variantId,
        sellerName: row.sellerName ?? null,
        sellerUuid: row.sellerUuid ?? null,
        quantity: row.quantity,
        totalPrice: String(row.totalPrice),
        unitPrice: unit,
        soldAt: new Date(row.soldAt),
        source: "import",
      },
    ]);
    inserted += n;
  }

  const data = CommitImportResponse.parse({
    rowsRead: body.rows.length,
    accepted: validRows.length,
    rejected: errors.length,
    duplicates: validRows.length - inserted,
    committed: true,
    errors,
  });
  res.json(data);
});

export default router;
