import {
  index,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const leaderboardSnapshots = pgTable(
  "leaderboard_snapshots",
  {
    id: serial("id").primaryKey(),
    category: text("category").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    pageCount: integer("page_count").notNull().default(0),
    status: text("status").notNull().default("complete"),
    syncRunId: integer("sync_run_id"),
  },
  (t) => [index("leaderboard_snapshots_cat_idx").on(t.category, t.capturedAt)],
);

export const leaderboardEntries = pgTable(
  "leaderboard_entries",
  {
    id: serial("id").primaryKey(),
    snapshotId: integer("snapshot_id")
      .notNull()
      .references(() => leaderboardSnapshots.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    rank: integer("rank").notNull(),
    username: text("username"),
    uuid: text("uuid"),
    rawValue: text("raw_value"),
    parsedNumeric: numeric("parsed_numeric", { precision: 30, scale: 4 }),
    parsedDurationSeconds: integer("parsed_duration_seconds"),
  },
  (t) => [
    uniqueIndex("leaderboard_entry_snapshot_rank_uq").on(
      t.snapshotId,
      t.category,
      t.rank,
    ),
    index("leaderboard_entry_username_idx").on(t.username),
  ],
);

export type LeaderboardSnapshot = typeof leaderboardSnapshots.$inferSelect;
export type InsertLeaderboardSnapshot =
  typeof leaderboardSnapshots.$inferInsert;
export type LeaderboardEntryRow = typeof leaderboardEntries.$inferSelect;
export type InsertLeaderboardEntry = typeof leaderboardEntries.$inferInsert;
