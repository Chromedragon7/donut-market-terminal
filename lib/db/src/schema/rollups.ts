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

export const marketPriceRollups = pgTable(
  "market_price_rollups",
  {
    id: serial("id").primaryKey(),
    scopeKey: text("scope_key").notNull(),
    interval: text("interval").notNull(),
    bucketStart: timestamp("bucket_start", { withTimezone: true }).notNull(),
    open: numeric("open", { precision: 30, scale: 8 }),
    high: numeric("high", { precision: 30, scale: 8 }),
    low: numeric("low", { precision: 30, scale: 8 }),
    close: numeric("close", { precision: 30, scale: 8 }),
    median: numeric("median", { precision: 30, scale: 8 }),
    mean: numeric("mean", { precision: 30, scale: 8 }),
    p25: numeric("p25", { precision: 30, scale: 8 }),
    p75: numeric("p75", { precision: 30, scale: 8 }),
    soldQuantity: integer("sold_quantity").notNull().default(0),
    transactionCount: integer("transaction_count").notNull().default(0),
    totalTradedValue: numeric("total_traded_value", {
      precision: 30,
      scale: 4,
    }),
    distinctSellerCount: integer("distinct_seller_count").notNull().default(0),
    sampleConfidence: numeric("sample_confidence", {
      precision: 5,
      scale: 2,
    }),
  },
  (t) => [
    uniqueIndex("rollup_scope_interval_bucket_uq").on(
      t.scopeKey,
      t.interval,
      t.bucketStart,
    ),
    index("rollup_scope_interval_idx").on(t.scopeKey, t.interval, t.bucketStart),
  ],
);

export type MarketPriceRollup = typeof marketPriceRollups.$inferSelect;
export type InsertMarketPriceRollup = typeof marketPriceRollups.$inferInsert;
