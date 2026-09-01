import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const players = pgTable(
  "players",
  {
    id: serial("id").primaryKey(),
    uuid: text("uuid"),
    username: text("username").notNull(),
    normalizedUsername: text("normalized_username").notNull(),
    location: text("location"),
    rank: text("rank"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("players_normalized_username_uq").on(t.normalizedUsername),
    index("players_uuid_idx").on(t.uuid),
  ],
);

export const playerStatSnapshots = pgTable(
  "player_stat_snapshots",
  {
    id: serial("id").primaryKey(),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    brokenBlocks: text("broken_blocks"),
    deaths: text("deaths"),
    kills: text("kills"),
    mobsKilled: text("mobs_killed"),
    money: text("money"),
    moneyMadeFromSell: text("money_made_from_sell"),
    moneySpentOnShop: text("money_spent_on_shop"),
    placedBlocks: text("placed_blocks"),
    playtime: text("playtime"),
    shards: text("shards"),
    moneyNumeric: numeric("money_numeric", { precision: 30, scale: 4 }),
    playtimeSeconds: integer("playtime_seconds"),
    rawJson: jsonb("raw_json"),
  },
  (t) => [index("player_stat_player_idx").on(t.playerId, t.capturedAt)],
);

export const watchedPlayers = pgTable(
  "watched_players",
  {
    id: serial("id").primaryKey(),
    username: text("username").notNull(),
    normalizedUsername: text("normalized_username").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("watched_players_username_uq").on(t.normalizedUsername),
  ],
);

export type Player = typeof players.$inferSelect;
export type InsertPlayer = typeof players.$inferInsert;
export type PlayerStatSnapshot = typeof playerStatSnapshots.$inferSelect;
export type InsertPlayerStatSnapshot =
  typeof playerStatSnapshots.$inferInsert;
export type WatchedPlayer = typeof watchedPlayers.$inferSelect;
