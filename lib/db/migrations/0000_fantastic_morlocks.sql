CREATE TABLE "item_variants" (
	"id" serial PRIMARY KEY NOT NULL,
	"base_item_id" text NOT NULL,
	"display_name" text NOT NULL,
	"normalized_display_name" text NOT NULL,
	"variant_hash" text NOT NULL,
	"enchantments_json" jsonb,
	"trim_json" jsonb,
	"lore_json" jsonb,
	"contents_json" jsonb,
	"canonical_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"dedupe_hash" text NOT NULL,
	"item_variant_id" integer NOT NULL,
	"seller_name" text,
	"seller_uuid" text,
	"quantity" integer NOT NULL,
	"total_price" numeric(30, 4) NOT NULL,
	"unit_price" numeric(30, 8) NOT NULL,
	"sold_at" timestamp with time zone NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text DEFAULT 'collector' NOT NULL,
	"raw_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "current_auction_listings" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_id" integer NOT NULL,
	"item_variant_id" integer NOT NULL,
	"seller_name" text,
	"seller_uuid" text,
	"quantity" integer NOT NULL,
	"total_price" numeric(30, 4) NOT NULL,
	"unit_price" numeric(30, 8) NOT NULL,
	"time_left_ms" integer,
	"approx_expires_at" timestamp with time zone,
	"raw_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "listing_market_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"bucket_ts" timestamp with time zone NOT NULL,
	"base_item_id" text NOT NULL,
	"variant_id" integer,
	"variant_hash" text,
	"active_listing_count" integer NOT NULL,
	"listed_quantity" integer NOT NULL,
	"min_ask" numeric(30, 8),
	"p25_ask" numeric(30, 8),
	"median_ask" numeric(30, 8),
	"avg_ask" numeric(30, 8),
	"p75_ask" numeric(30, 8),
	"max_ask" numeric(30, 8),
	"weighted_avg_ask" numeric(30, 8),
	"source_snapshot_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_price_rollups" (
	"id" serial PRIMARY KEY NOT NULL,
	"scope_key" text NOT NULL,
	"interval" text NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"open" numeric(30, 8),
	"high" numeric(30, 8),
	"low" numeric(30, 8),
	"close" numeric(30, 8),
	"median" numeric(30, 8),
	"mean" numeric(30, 8),
	"p25" numeric(30, 8),
	"p75" numeric(30, 8),
	"sold_quantity" integer DEFAULT 0 NOT NULL,
	"transaction_count" integer DEFAULT 0 NOT NULL,
	"total_traded_value" numeric(30, 4),
	"distinct_seller_count" integer DEFAULT 0 NOT NULL,
	"sample_confidence" numeric(5, 2)
);
--> statement-breakpoint
CREATE TABLE "leaderboard_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_id" integer NOT NULL,
	"category" text NOT NULL,
	"rank" integer NOT NULL,
	"username" text,
	"uuid" text,
	"raw_value" text,
	"parsed_numeric" numeric(30, 4),
	"parsed_duration_seconds" integer
);
--> statement-breakpoint
CREATE TABLE "leaderboard_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"page_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'complete' NOT NULL,
	"sync_run_id" integer
);
--> statement-breakpoint
CREATE TABLE "player_stat_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"broken_blocks" text,
	"deaths" text,
	"kills" text,
	"mobs_killed" text,
	"money" text,
	"money_made_from_sell" text,
	"money_spent_on_shop" text,
	"placed_blocks" text,
	"playtime" text,
	"shards" text,
	"money_numeric" numeric(30, 4),
	"playtime_seconds" integer,
	"raw_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" serial PRIMARY KEY NOT NULL,
	"uuid" text,
	"username" text NOT NULL,
	"normalized_username" text NOT NULL,
	"location" text,
	"rank" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watched_players" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"normalized_username" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_imports" (
	"id" serial PRIMARY KEY NOT NULL,
	"filename" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"rows_read" integer DEFAULT 0 NOT NULL,
	"rows_accepted" integer DEFAULT 0 NOT NULL,
	"rows_rejected" integer DEFAULT 0 NOT NULL,
	"validation_report" jsonb
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_type" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"upstream_request_count" integer DEFAULT 0 NOT NULL,
	"pages_fetched" integer DEFAULT 0 NOT NULL,
	"records_seen" integer DEFAULT 0 NOT NULL,
	"records_inserted" integer DEFAULT 0 NOT NULL,
	"records_updated" integer DEFAULT 0 NOT NULL,
	"complete" text DEFAULT 'complete' NOT NULL,
	"error_summary" text,
	"last_cursor" text
);
--> statement-breakpoint
ALTER TABLE "sales_transactions" ADD CONSTRAINT "sales_transactions_item_variant_id_item_variants_id_fk" FOREIGN KEY ("item_variant_id") REFERENCES "public"."item_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "current_auction_listings" ADD CONSTRAINT "current_auction_listings_item_variant_id_item_variants_id_fk" FOREIGN KEY ("item_variant_id") REFERENCES "public"."item_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_snapshot_id_leaderboard_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."leaderboard_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_stat_snapshots" ADD CONSTRAINT "player_stat_snapshots_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "item_variants_variant_hash_uq" ON "item_variants" USING btree ("variant_hash");--> statement-breakpoint
CREATE INDEX "item_variants_base_item_idx" ON "item_variants" USING btree ("base_item_id");--> statement-breakpoint
CREATE INDEX "item_variants_display_name_idx" ON "item_variants" USING btree ("normalized_display_name");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_dedupe_hash_uq" ON "sales_transactions" USING btree ("dedupe_hash");--> statement-breakpoint
CREATE INDEX "sales_variant_sold_idx" ON "sales_transactions" USING btree ("item_variant_id","sold_at");--> statement-breakpoint
CREATE INDEX "sales_sold_at_idx" ON "sales_transactions" USING btree ("sold_at");--> statement-breakpoint
CREATE INDEX "sales_seller_uuid_idx" ON "sales_transactions" USING btree ("seller_uuid");--> statement-breakpoint
CREATE INDEX "sales_unit_price_idx" ON "sales_transactions" USING btree ("unit_price");--> statement-breakpoint
CREATE INDEX "listings_variant_price_idx" ON "current_auction_listings" USING btree ("item_variant_id","unit_price");--> statement-breakpoint
CREATE INDEX "listings_snapshot_idx" ON "current_auction_listings" USING btree ("snapshot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "listing_snapshot_scope_bucket_uq" ON "listing_market_snapshots" USING btree ("base_item_id","variant_hash","bucket_ts");--> statement-breakpoint
CREATE INDEX "listing_snapshot_base_bucket_idx" ON "listing_market_snapshots" USING btree ("base_item_id","bucket_ts");--> statement-breakpoint
CREATE UNIQUE INDEX "rollup_scope_interval_bucket_uq" ON "market_price_rollups" USING btree ("scope_key","interval","bucket_start");--> statement-breakpoint
CREATE INDEX "rollup_scope_interval_idx" ON "market_price_rollups" USING btree ("scope_key","interval","bucket_start");--> statement-breakpoint
CREATE UNIQUE INDEX "leaderboard_entry_snapshot_rank_uq" ON "leaderboard_entries" USING btree ("snapshot_id","category","rank");--> statement-breakpoint
CREATE INDEX "leaderboard_entry_username_idx" ON "leaderboard_entries" USING btree ("username");--> statement-breakpoint
CREATE INDEX "leaderboard_snapshots_cat_idx" ON "leaderboard_snapshots" USING btree ("category","captured_at");--> statement-breakpoint
CREATE INDEX "player_stat_player_idx" ON "player_stat_snapshots" USING btree ("player_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "players_normalized_username_uq" ON "players" USING btree ("normalized_username");--> statement-breakpoint
CREATE INDEX "players_uuid_idx" ON "players" USING btree ("uuid");--> statement-breakpoint
CREATE UNIQUE INDEX "watched_players_username_uq" ON "watched_players" USING btree ("normalized_username");