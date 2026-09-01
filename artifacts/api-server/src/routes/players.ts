import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import {
  db,
  getPlayer,
  playerStatSnapshots,
  leaderboardEntries,
} from "@workspace/donut-data";
import { parseLeaderboardValue } from "@workspace/donut";
import {
  GetPlayerResponse,
  GetPlayerQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

const STAT_LABELS: Array<{ key: string; label: string }> = [
  { key: "money", label: "Money" },
  { key: "shards", label: "Shards" },
  { key: "kills", label: "Kills" },
  { key: "deaths", label: "Deaths" },
  { key: "mobsKilled", label: "Mobs Killed" },
  { key: "brokenBlocks", label: "Broken Blocks" },
  { key: "placedBlocks", label: "Placed Blocks" },
  { key: "playtime", label: "Playtime" },
  { key: "moneyMadeFromSell", label: "Money From Sells" },
  { key: "moneySpentOnShop", label: "Money Spent" },
];

router.get("/players", async (req, res) => {
  const params = GetPlayerQueryParams.parse(req.query);
  const view = await getPlayer(params.user, params.refresh);

  if (!view) {
    const data = GetPlayerResponse.parse({
      username: params.user,
      uuid: null,
      found: false,
      rank: null,
      location: null,
      cachedAt: null,
      stats: [],
      history: [],
      leaderboardAppearances: [],
    });
    res.json(data);
    return;
  }

  const latest = view.latestStats;
  const stats = latest
    ? STAT_LABELS.map(({ key, label }) => {
        const rawValue =
          (latest[key as keyof typeof latest] as string | null) ?? "";
        const parsed = parseLeaderboardValue(rawValue);
        return {
          key,
          label,
          rawValue: String(rawValue),
          numericValue:
            parsed.numeric ?? parsed.durationSeconds ?? null,
        };
      })
    : [];

  const historyRows = await db
    .select()
    .from(playerStatSnapshots)
    .where(eq(playerStatSnapshots.playerId, view.player.id))
    .orderBy(desc(playerStatSnapshots.capturedAt))
    .limit(90);
  const history = historyRows
    .reverse()
    .map((h) => ({
      t: h.capturedAt.toISOString(),
      money: h.moneyNumeric !== null ? Number(h.moneyNumeric) : null,
      kills: h.kills !== null ? parseLeaderboardValue(h.kills).numeric : null,
      playtime: h.playtimeSeconds,
    }));

  const appearances = await db
    .select()
    .from(leaderboardEntries)
    .where(eq(leaderboardEntries.username, view.player.username))
    .limit(50);

  const data = GetPlayerResponse.parse({
    username: view.player.username,
    uuid: view.player.uuid,
    found: true,
    rank: view.player.rank,
    location: view.player.location,
    cachedAt: latest?.capturedAt.toISOString() ?? null,
    stats,
    history,
    leaderboardAppearances: appearances.map((a) => ({
      rank: a.rank,
      username: a.username ?? view.player.username,
      uuid: a.uuid,
      rawValue: a.rawValue ?? "",
      numericValue:
        a.parsedNumeric !== null
          ? Number(a.parsedNumeric)
          : a.parsedDurationSeconds,
      rankChange: null,
    })),
  });
  res.json(data);
});

export default router;
