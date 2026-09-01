import { Router, type IRouter } from "express";
import { and, asc, desc, eq, ilike, sql } from "drizzle-orm";
import {
  db,
  leaderboardEntries,
  leaderboardSnapshots,
} from "@workspace/donut-data";
import {
  GetLeaderboardResponse,
  GetLeaderboardQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/leaderboards", async (req, res) => {
  const params = GetLeaderboardQueryParams.parse(req.query);

  const snapshotRows = await db
    .select()
    .from(leaderboardSnapshots)
    .where(eq(leaderboardSnapshots.category, params.category))
    .orderBy(desc(leaderboardSnapshots.capturedAt))
    .limit(2);
  const snapshot = snapshotRows[0];
  const previousSnapshot = snapshotRows[1];

  if (!snapshot) {
    const empty = GetLeaderboardResponse.parse({
      category: params.category,
      capturedAt: null,
      rows: [],
      total: 0,
      page: params.page,
      pageSize: params.pageSize,
    });
    res.json(empty);
    return;
  }

  const conditions = [eq(leaderboardEntries.snapshotId, snapshot.id)];
  if (params.search) {
    conditions.push(ilike(leaderboardEntries.username, `%${params.search}%`));
  }
  const where = and(...conditions);

  const [{ c: total } = { c: 0 }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(leaderboardEntries)
    .where(where);

  const rows = await db
    .select()
    .from(leaderboardEntries)
    .where(where)
    .orderBy(asc(leaderboardEntries.rank))
    .limit(params.pageSize)
    .offset((params.page - 1) * params.pageSize);

  const previousRanks = new Map<string, number>();
  if (previousSnapshot) {
    const prevRows = await db
      .select({
        username: leaderboardEntries.username,
        rank: leaderboardEntries.rank,
      })
      .from(leaderboardEntries)
      .where(eq(leaderboardEntries.snapshotId, previousSnapshot.id));
    for (const p of prevRows) {
      if (p.username) previousRanks.set(p.username, p.rank);
    }
  }

  const data = GetLeaderboardResponse.parse({
    category: params.category,
    capturedAt: snapshot.capturedAt.toISOString(),
    rows: rows.map((r) => {
      const prevRank =
        r.username !== null ? previousRanks.get(r.username) : undefined;
      return {
        rank: r.rank,
        username: r.username ?? "unknown",
        uuid: r.uuid,
        rawValue: r.rawValue ?? "",
        numericValue:
          r.parsedNumeric !== null
            ? Number(r.parsedNumeric)
            : r.parsedDurationSeconds,
        rankChange: prevRank !== undefined ? prevRank - r.rank : null,
      };
    }),
    total,
    page: params.page,
    pageSize: params.pageSize,
  });
  res.json(data);
});

export default router;
