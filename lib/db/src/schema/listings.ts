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

export const currentAuctionListings = pgTable(
  "current_auction_listings",
  {
    id: serial("id").primaryKey(),
    snapshotId: integer("snapshot_id").notNull(),
    itemVariantId: integer("item_variant_id")
      .notNull()
      .references(() => itemVariants.id),
    sellerName: text("seller_name"),
    sellerUuid: text("seller_uuid"),
    quantity: integer("quantity").notNull(),
    totalPrice: numeric("total_price", { precision: 30, scale: 4 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 30, scale: 8 }).notNull(),
    timeLeftMs: integer("time_left_ms"),
    approxExpiresAt: timestamp("approx_expires_at", { withTimezone: true }),
    rawJson: jsonb("raw_json"),
  },
  (t) => [
    index("listings_variant_price_idx").on(t.itemVariantId, t.unitPrice),
    index("listings_snapshot_idx").on(t.snapshotId),
  ],
);

export const listingMarketSnapshots = pgTable(
  "listing_market_snapshots",
  {
    id: serial("id").primaryKey(),
    bucketTs: timestamp("bucket_ts", { withTimezone: true }).notNull(),
    baseItemId: text("base_item_id").notNull(),
    variantId: integer("variant_id"),
    variantHash: text("variant_hash"),
    activeListingCount: integer("active_listing_count").notNull(),
    listedQuantity: integer("listed_quantity").notNull(),
    minAsk: numeric("min_ask", { precision: 30, scale: 8 }),
    p25Ask: numeric("p25_ask", { precision: 30, scale: 8 }),
    medianAsk: numeric("median_ask", { precision: 30, scale: 8 }),
    avgAsk: numeric("avg_ask", { precision: 30, scale: 8 }),
    p75Ask: numeric("p75_ask", { precision: 30, scale: 8 }),
    maxAsk: numeric("max_ask", { precision: 30, scale: 8 }),
    weightedAvgAsk: numeric("weighted_avg_ask", { precision: 30, scale: 8 }),
    sourceSnapshotId: integer("source_snapshot_id").notNull(),
  },
  (t) => [
    uniqueIndex("listing_snapshot_scope_bucket_uq").on(
      t.baseItemId,
      t.variantHash,
      t.bucketTs,
    ),
    index("listing_snapshot_base_bucket_idx").on(t.baseItemId, t.bucketTs),
  ],
);

export type CurrentAuctionListing = typeof currentAuctionListings.$inferSelect;
export type InsertCurrentAuctionListing =
  typeof currentAuctionListings.$inferInsert;
export type ListingMarketSnapshot =
  typeof listingMarketSnapshots.$inferSelect;
export type InsertListingMarketSnapshot =
  typeof listingMarketSnapshots.$inferInsert;
