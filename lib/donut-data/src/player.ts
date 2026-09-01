import { desc, eq } from "drizzle-orm";
import {
  players,
  playerStatSnapshots,
  type Player,
  type PlayerStatSnapshot,
} from "@workspace/db";
import {
  config,
  createDonutClient,
  parseLeaderboardValue,
} from "@workspace/donut";
import { db } from "./db";

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export interface PlayerView {
  player: Player;
  latestStats: PlayerStatSnapshot | null;
  stale: boolean;
}

async function loadPlayer(username: string): Promise<PlayerView | null> {
  const normalized = normalizeUsername(username);
  const rows = await db
    .select()
    .from(players)
    .where(eq(players.normalizedUsername, normalized))
    .limit(1);
  const player = rows[0];
  if (!player) return null;
  const statRows = await db
    .select()
    .from(playerStatSnapshots)
    .where(eq(playerStatSnapshots.playerId, player.id))
    .orderBy(desc(playerStatSnapshots.capturedAt))
    .limit(1);
  const latest = statRows[0] ?? null;
  const ageMs = latest
    ? Date.now() - latest.capturedAt.getTime()
    : Number.POSITIVE_INFINITY;
  const stale = ageMs > config.playerCacheMinutes * 60 * 1000;
  return { player, latestStats: latest, stale };
}

export async function refreshPlayer(
  username: string,
  force = false,
): Promise<PlayerView> {
  const normalized = normalizeUsername(username);
  if (!force) {
    const existing = await loadPlayer(username);
    if (existing && !existing.stale) return existing;
  }

  const client = createDonutClient();
  const lookup = await client.lookup(username);
  const stats = await client.playerStats(username);
  const result = lookup.result;
  const displayUsername = result?.username ?? username;

  const upserted = await db
    .insert(players)
    .values({
      username: displayUsername,
      normalizedUsername: normalized,
      location: result?.location ?? null,
      rank: result?.rank ?? null,
    })
    .onConflictDoUpdate({
      target: players.normalizedUsername,
      set: {
        username: displayUsername,
        location: result?.location ?? null,
        rank: result?.rank ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();
  const player = upserted[0];

  const s = stats.result ?? {};
  const moneyParsed = parseLeaderboardValue(s.money ?? undefined);
  const playtimeParsed = parseLeaderboardValue(s.playtime ?? undefined);
  await db.insert(playerStatSnapshots).values({
    playerId: player.id,
    brokenBlocks: s.broken_blocks ?? null,
    deaths: s.deaths ?? null,
    kills: s.kills ?? null,
    mobsKilled: s.mobs_killed ?? null,
    money: s.money ?? null,
    moneyMadeFromSell: s.money_made_from_sell ?? null,
    moneySpentOnShop: s.money_spent_on_shop ?? null,
    placedBlocks: s.placed_blocks ?? null,
    playtime: s.playtime ?? null,
    shards: s.shards ?? null,
    moneyNumeric: moneyParsed.numeric === null ? null : String(moneyParsed.numeric),
    playtimeSeconds: playtimeParsed.durationSeconds,
    rawJson: stats,
  });

  const refreshed = await loadPlayer(username);
  if (!refreshed) throw new Error("Failed to load player after refresh");
  return refreshed;
}

export async function getPlayer(
  username: string,
  forceRefresh = false,
): Promise<PlayerView | null> {
  if (forceRefresh) return refreshPlayer(username, true);
  const existing = await loadPlayer(username);
  if (existing && !existing.stale) return existing;
  try {
    return await refreshPlayer(username);
  } catch {
    return existing;
  }
}

export async function addWatchedPlayer(username: string): Promise<void> {
  const { watchedPlayers } = await import("@workspace/db");
  await db
    .insert(watchedPlayers)
    .values({
      username,
      normalizedUsername: normalizeUsername(username),
    })
    .onConflictDoNothing();
}

export async function removeWatchedPlayer(username: string): Promise<void> {
  const { watchedPlayers } = await import("@workspace/db");
  await db
    .delete(watchedPlayers)
    .where(eq(watchedPlayers.normalizedUsername, normalizeUsername(username)));
}

export async function listWatchedPlayers(): Promise<string[]> {
  const { watchedPlayers } = await import("@workspace/db");
  const rows = await db.select().from(watchedPlayers);
  return rows.map((r) => r.username);
}
