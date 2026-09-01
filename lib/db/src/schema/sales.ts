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
import { itemVariants } from "./items";

export const salesTransactions = pgTable(
  "sales_transactions",
  {
    id: serial("id").primaryKey(),
    dedupeHash: text("dedupe_hash").notNull(),
    itemVariantId: integer("item_variant_id")
      .notNull()
      .references(() => itemVariants.id),
    sellerName: text("seller_name"),
    sellerUuid: text("seller_uuid"),
    quantity: integer("quantity").notNull(),
    totalPrice: numeric("total_price", { precision: 30, scale: 4 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 30, scale: 8 }).notNull(),
    soldAt: timestamp("sold_at", { withTimezone: true }).notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    source: text("source").notNull().default("collector"),
    rawJson: jsonb("raw_json"),
  },
  (t) => [
    uniqueIndex("sales_dedupe_hash_uq").on(t.dedupeHash),
    index("sales_variant_sold_idx").on(t.itemVariantId, t.soldAt),
    index("sales_sold_at_idx").on(t.soldAt),
    index("sales_seller_uuid_idx").on(t.sellerUuid),
    index("sales_unit_price_idx").on(t.unitPrice),
  ],
);

export type SalesTransaction = typeof salesTransactions.$inferSelect;
export type InsertSalesTransaction = typeof salesTransactions.$inferInsert;
