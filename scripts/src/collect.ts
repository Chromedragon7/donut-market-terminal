import {
  runTransactionsSync,
  runListingsSync,
  runLeaderboardsSync,
  runWatchedPlayersSync,
  runMarketRollup,
  runCleanup,
  runSyncAll,
  type SyncResult,
} from "@workspace/donut-data";
import { hasApiKey } from "@workspace/donut";

type Job =
  | "transactions"
  | "listings"
  | "leaderboards"
  | "watched"
  | "rollups"
  | "cleanup"
  | "all";

const JOBS: Record<Job, () => Promise<SyncResult | Record<string, SyncResult>>> =
  {
    transactions: runTransactionsSync,
    listings: runListingsSync,
    leaderboards: runLeaderboardsSync,
    watched: runWatchedPlayersSync,
    rollups: runMarketRollup,
    cleanup: runCleanup,
    all: runSyncAll,
  };

async function main(): Promise<void> {
  const job = (process.argv[2] ?? "all") as Job;
  const runner = JOBS[job];
  if (!runner) {
    console.error(
      `Unknown job "${job}". Valid jobs: ${Object.keys(JOBS).join(", ")}`,
    );
    process.exit(1);
  }
  if (job !== "cleanup" && job !== "rollups" && !hasApiKey()) {
    console.error(
      "DONUTSMP_API_KEY is not configured. Set it before running collectors.",
    );
    process.exit(1);
  }

  const startedAt = Date.now();
  console.log(`[collect] starting job "${job}"...`);
  try {
    const result = await runner();
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`[collect] job "${job}" finished in ${elapsed}s`);
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(`[collect] job "${job}" failed:`, err);
    process.exit(1);
  }
}

void main();
