import { randomUUID } from "node:crypto";
import {
  createDatabasePool,
  MarketRepository as DatabaseMarketRepository,
  type OutboxEvent as DatabaseOutboxEvent,
  type Queryable,
} from "@donut/db";
import type {
  AlertRule,
  CloseableMarketRepository,
  CollectionHealth,
  CreateAlertInput,
  CreateDashboardInput,
  CreateModTokenInput,
  CreateWatchlistInput,
  CursorPage,
  Dashboard,
  DashboardCard,
  DataQuality,
  ExportBundle,
  FeatureAvailability,
  HistoryInput,
  HistoryPoint,
  ItemDetail,
  ItemSearchInput,
  ItemSummary,
  ListingRecord,
  MarketOverview,
  ModScope,
  OutboxEvent,
  PageInput,
  Provenance,
  ReadinessResult,
  SaleRecord,
  SourceHealth,
  StoredModToken,
  StoredSession,
  StoredUser,
  User,
  Watchlist,
} from "./contracts.js";
import { RepositoryError } from "./contracts.js";

interface DatabasePort {
  withTransaction<T>(operation: (client: Queryable) => Promise<T>): Promise<T>;
  readOutbox(
    afterCursor: string,
    limit: number,
    audiences: readonly DatabaseOutboxEvent["audience"][],
  ): Promise<readonly DatabaseOutboxEvent[]>;
  close(): Promise<void>;
}

export interface PostgresRepositoryOptions {
  queryable: Queryable;
  database: DatabasePort;
  initialOutboxCursor?: string;
  outboxPollMs?: number;
}

export interface CreatePostgresRepositoryOptions {
  connectionString: string;
  ownerUsername: string;
  ownerPasswordHash: string;
  ssl?: boolean | "require";
  maxConnections?: number;
  outboxPollMs?: number;
}

type Row = Record<string, unknown>;

function rows(result: { rows: unknown[] }): Row[] {
  return result.rows as Row[];
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : value === null || value === undefined ? null : String(value);
}

function requiredText(value: unknown, field: string): string {
  const mapped = text(value);
  if (mapped === null) throw new Error(`Database row is missing ${field}`);
  return mapped;
}

function integer(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

function timestamp(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return null;
}

function requiredTimestamp(value: unknown, field: string): string {
  const mapped = timestamp(value);
  if (mapped === null) throw new Error(`Database row has invalid ${field}`);
  return mapped;
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function normalizeCursor(cursor: string | null): number {
  if (cursor === null) return 0;
  if (!/^\d+$/.test(cursor)) throw new RepositoryError("INVALID_CURSOR", "Cursor is malformed");
  const parsed = Number(cursor);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new RepositoryError("INVALID_CURSOR", "Cursor is outside the supported range");
  }
  return parsed;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function freshness(value: unknown): DataQuality["freshness"] {
  if (value === "live" || value === "recent" || value === "stale") return value;
  if (value === "aging") return "stale";
  return "unknown";
}

function confidence(value: unknown): DataQuality["confidence"] {
  return value === "high" || value === "medium" || value === "low" ? value : "unknown";
}

function qualityFromRow(row: Row, extraFlags: string[] = []): DataQuality {
  const rawFlags = object(row.flags);
  const flags = [
    ...Object.entries(rawFlags).filter(([, enabled]) => enabled === true).map(([key]) => key),
    ...extraFlags,
  ];
  const completeness = row.completeness === "complete"
    ? "complete_observation"
    : row.completeness === "partial" || row.completeness === "gapped"
      ? "partial"
      : "unknown";
  if (row.gap_status === "possible" || row.gap_status === "confirmed") flags.push("historical_gap");
  return {
    freshness: freshness(row.freshness),
    confidence: confidence(row.confidence),
    sampleSize: row.sample_count === null || row.sample_count === undefined ? null : integer(row.sample_count),
    completeness,
    flags: [...new Set(flags)],
  };
}

function provenanceFromRow(row: Row, observedField = "observed_at", sourceTimestampField = "source_timestamp"): Provenance {
  return {
    sourceId: requiredText(row.source_key ?? row.source_id, "source id"),
    sourceType: row.source_type === "client_observation" || row.source_type === "manual"
      ? row.source_type
      : row.source_type === "derived"
        ? "derived"
        : "compatible_api",
    observedAt: requiredTimestamp(row[observedField], observedField),
    sourceTimestamp: timestamp(row[sourceTimestampField]),
    collectorVersion: text(row.collector_version) ?? "unknown",
  };
}

function mapUser(row: Row): User {
  const visibility = row.seller_visibility === "name_only" ? "name" : row.seller_visibility;
  return {
    id: requiredText(row.id, "user id"),
    username: requiredText(row.email_normalized ?? row.display_name, "username"),
    role: row.role === "owner" ? "owner" : "invited",
    sellerPrivacy: visibility === "full" || visibility === "name" || visibility === "pseudonymized"
      ? visibility
      : "hidden",
  };
}

function mapItem(row: Row): ItemDetail {
  const displayName = text(row.display_name) ?? requiredText(row.minecraft_id, "minecraft id");
  return {
    id: requiredText(row.id, "item variant id"),
    baseItemId: requiredText(row.minecraft_id, "minecraft id"),
    displayName,
    variantLabel: text(row.variant_label),
    identityState: row.identity_state === "excluded" ? "unclassified" : row.identity_state as ItemDetail["identityState"],
    lowestAsk: text(row.lowest_ask),
    recentSaleMedian: text(row.recent_sale_median),
    priceUnit: "server_currency",
    quality: qualityFromRow(row),
    description: text(row.description),
    metadata: object(row.canonical_metadata),
    recordedSaleCount: integer(row.recorded_sale_count ?? row.sample_count),
    activeListingCount: integer(row.active_listing_count),
  };
}

function mapListing(row: Row): ListingRecord {
  const approximateExpiry = timestamp(row.approximate_expires_at);
  const remainingSeconds = approximateExpiry === null
    ? null
    : Math.max(0, Math.floor((Date.parse(approximateExpiry) - Date.now()) / 1000));
  const flags = row.snapshot_status === "partial" ? ["partial_snapshot"] : [];
  if (row.snapshot_consistency === "changed_during_scan") flags.push("snapshot_changed_during_scan");
  return {
    id: requiredText(row.id, "listing observation id"),
    itemId: requiredText(row.item_variant_id, "item variant id"),
    quantity: integer(row.quantity),
    totalAsk: requiredText(row.total_ask_price, "total ask"),
    unitAsk: requiredText(row.unit_ask_price, "unit ask"),
    priceUnit: "server_currency",
    observedAt: requiredTimestamp(row.observed_at, "observed_at"),
    remainingSeconds,
    seller: { name: text(row.current_name), uuid: text(row.source_seller_id) },
    provenance: provenanceFromRow(row),
    quality: qualityFromRow(row, flags),
  };
}

function mapSale(row: Row): SaleRecord {
  return {
    id: requiredText(row.id, "sale id"),
    itemId: requiredText(row.item_variant_id, "item variant id"),
    quantity: integer(row.quantity),
    totalSale: requiredText(row.total_price, "total sale"),
    unitSale: requiredText(row.unit_price, "unit sale"),
    priceUnit: "server_currency",
    soldAt: requiredTimestamp(row.source_sold_at, "source_sold_at"),
    ingestedAt: requiredTimestamp(row.last_observed_at, "last_observed_at"),
    seller: { name: text(row.current_name), uuid: text(row.source_seller_id) },
    provenance: provenanceFromRow(row, "last_observed_at", "source_sold_at"),
    quality: qualityFromRow(row),
  };
}

const itemProjection = `
  iv.id::text AS id, ci.minecraft_id, COALESCE(ci.display_name, ci.minecraft_id) AS display_name,
  NULLIF(iv.canonical_metadata->>'variantLabel', '') AS variant_label,
  NULLIF(iv.canonical_metadata->>'description', '') AS description,
  iv.canonical_metadata, iv.identity_state,
  summary.lowest_ask::text, summary.recent_sale_median::text,
  summary.sample_count::text, summary.active_listing_count::text,
  summary.confidence, summary.freshness, summary.completeness, summary.gap_status,
  COALESCE(sale_count.count, 0)::text AS recorded_sale_count`;

const itemJoins = `
  JOIN canonical_items ci ON ci.id = iv.canonical_item_id
  LEFT JOIN LATERAL (
    SELECT ms.* FROM market_summaries ms
    WHERE ms.item_variant_id = iv.id
    ORDER BY ms.observed_at DESC LIMIT 1
  ) summary ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS count FROM logical_transactions lt WHERE lt.item_variant_id = iv.id
  ) sale_count ON true`;

export class PostgresMarketRepository implements CloseableMarketRepository {
  private readonly listeners = new Map<(event: OutboxEvent) => void, Set<OutboxEvent["audience"]>>();
  private pollTimer: NodeJS.Timeout | null = null;
  private pollInFlight = false;
  private outboxCursor: string;
  private closed = false;

  constructor(private readonly options: PostgresRepositoryOptions) {
    this.outboxCursor = options.initialOutboxCursor ?? "0";
  }

  async readiness(): Promise<ReadinessResult> {
    const result = await this.options.queryable.query(
      `/* api.readiness */
       SELECT to_regclass('public.users') IS NOT NULL AS users_ready,
              to_regclass('public.logical_transactions') IS NOT NULL AS market_ready,
              to_regclass('public.outbox_events') IS NOT NULL AS outbox_ready`,
    );
    const row = rows(result)[0] ?? {};
    const ready = row.users_ready === true && row.market_ready === true && row.outbox_ready === true;
    return {
      ready,
      checks: {
        repository: ready ? "ready" : "not_ready",
        users: row.users_ready === true ? "ready" : "not_ready",
        market: row.market_ready === true ? "ready" : "not_ready",
        outbox: row.outbox_ready === true ? "ready" : "not_ready",
      },
    };
  }

  async findUserByUsername(username: string): Promise<StoredUser | null> {
    const result = await this.options.queryable.query(
      `/* api.findUserByUsername */
       SELECT id::text, email_normalized, display_name, role, seller_visibility, password_hash
       FROM users
       WHERE status = 'active'
         AND password_hash IS NOT NULL
         AND email_normalized = lower($1)
       LIMIT 1`,
      [username],
    );
    const row = rows(result)[0];
    return row === undefined ? null : { user: mapUser(row), passwordHash: requiredText(row.password_hash, "password hash") };
  }

  async findUserById(userId: string): Promise<User | null> {
    const result = await this.options.queryable.query(
      `/* api.findUserById */
       SELECT id::text, email_normalized, display_name, role, seller_visibility
       FROM users WHERE id::text = $1 AND status = 'active' LIMIT 1`,
      [userId],
    );
    const row = rows(result)[0];
    return row === undefined ? null : mapUser(row);
  }

  async createSession(session: StoredSession): Promise<void> {
    await this.options.queryable.query(
      `/* api.createSession */
       INSERT INTO sessions (
         id, user_id, token_hash, token_kind, scopes, created_at, expires_at, revoked_at, metadata
       ) VALUES ($1, $2, $3, 'browser', $4::text[], $5, $6, $7, $8::jsonb)`,
      [session.id, session.userId, session.tokenHash, ["market:read", "stream:read"],
        session.createdAt, session.expiresAt, session.revokedAt, JSON.stringify({ csrfHash: session.csrfHash })],
    );
  }

  async findSessionByTokenHash(tokenHash: string): Promise<StoredSession | null> {
    const result = await this.options.queryable.query(
      `/* api.findSessionByTokenHash */
       SELECT id::text, user_id::text, token_hash, created_at, expires_at, revoked_at, metadata
       FROM sessions WHERE token_hash = $1 AND token_kind = 'browser' LIMIT 1`,
      [tokenHash],
    );
    const row = rows(result)[0];
    if (row === undefined) return null;
    const csrfHash = text(object(row.metadata).csrfHash);
    if (csrfHash === null || !/^[a-f0-9]{64}$/.test(csrfHash)) return null;
    return {
      id: requiredText(row.id, "session id"),
      userId: requiredText(row.user_id, "session user id"),
      tokenHash: requiredText(row.token_hash, "session token hash"),
      csrfHash,
      createdAt: requiredTimestamp(row.created_at, "created_at"),
      expiresAt: requiredTimestamp(row.expires_at, "expires_at"),
      revokedAt: timestamp(row.revoked_at),
    };
  }

  async revokeSession(sessionId: string, revokedAt: string): Promise<void> {
    await this.options.queryable.query(
      `/* api.revokeSession */ UPDATE sessions SET revoked_at = COALESCE(revoked_at, $2) WHERE id::text = $1 AND token_kind = 'browser'`,
      [sessionId, revokedAt],
    );
  }

  async createModToken(input: CreateModTokenInput): Promise<void> {
    await this.options.queryable.query(
      `/* api.createModToken */
       INSERT INTO sessions (id, user_id, token_hash, token_kind, scopes, created_at, expires_at, metadata)
       VALUES ($1, $2, $3, 'mod', $4::text[], $5, $6, $7::jsonb)`,
      [input.id, input.userId, input.tokenHash, input.scopes, input.createdAt, input.expiresAt,
        JSON.stringify({ label: input.label })],
    );
  }

  private mapModToken(row: Row): StoredModToken {
    const scopes = stringArray(row.scopes).filter((scope): scope is ModScope => scope === "market:read" || scope === "stream:read");
    return {
      id: requiredText(row.id, "mod token id"),
      userId: requiredText(row.user_id, "mod token user id"),
      label: text(object(row.metadata).label) ?? "Minecraft client",
      tokenHash: requiredText(row.token_hash, "mod token hash"),
      scopes,
      createdAt: requiredTimestamp(row.created_at, "created_at"),
      expiresAt: timestamp(row.expires_at),
      revokedAt: timestamp(row.revoked_at),
    };
  }

  async findModTokenByHash(tokenHash: string): Promise<StoredModToken | null> {
    const result = await this.options.queryable.query(
      `/* api.findModTokenByHash */
       SELECT id::text, user_id::text, token_hash, scopes, created_at, expires_at, revoked_at, metadata
       FROM sessions WHERE token_hash = $1 AND token_kind = 'mod' LIMIT 1`,
      [tokenHash],
    );
    const row = rows(result)[0];
    return row === undefined ? null : this.mapModToken(row);
  }

  async listModTokens(userId: string): Promise<StoredModToken[]> {
    const result = await this.options.queryable.query(
      `/* api.listModTokens */
       SELECT id::text, user_id::text, token_hash, scopes, created_at, expires_at, revoked_at, metadata
       FROM sessions WHERE user_id::text = $1 AND token_kind = 'mod' ORDER BY created_at DESC`,
      [userId],
    );
    return rows(result).map((row) => this.mapModToken(row));
  }

  async revokeModToken(userId: string, tokenId: string, revokedAt: string): Promise<boolean> {
    const result = await this.options.queryable.query(
      `/* api.revokeModToken */
       UPDATE sessions SET revoked_at = COALESCE(revoked_at, $3), revocation_reason = 'user_revoked'
       WHERE id::text = $2 AND user_id::text = $1 AND token_kind = 'mod'`,
      [userId, tokenId, revokedAt],
    );
    return result.rowCount === 1;
  }

  async searchItems(input: ItemSearchInput): Promise<CursorPage<ItemSummary>> {
    const offset = normalizeCursor(input.cursor);
    const result = await this.options.queryable.query(
      `/* api.searchItems */
       SELECT ${itemProjection}, count(*) OVER()::text AS total_count
       FROM item_variants iv ${itemJoins}
       WHERE iv.identity_state <> 'excluded'
         AND ($1 = '' OR ci.minecraft_id ILIKE $2 ESCAPE '\\' OR COALESCE(ci.display_name, '') ILIKE $2 ESCAPE '\\')
       ORDER BY COALESCE(ci.display_name, ci.minecraft_id), iv.id
       LIMIT $3 OFFSET $4`,
      [input.query.trim(), `%${escapeLike(input.query.trim())}%`, input.limit, offset],
    );
    const mapped = rows(result).map(mapItem);
    const total = integer(rows(result)[0]?.total_count, 0);
    return { items: mapped, total, nextCursor: offset + mapped.length < total ? String(offset + mapped.length) : null };
  }

  async getItem(itemId: string): Promise<ItemDetail | null> {
    const result = await this.options.queryable.query(
      `/* api.getItem */
       SELECT ${itemProjection}
       FROM item_variants iv ${itemJoins}
       WHERE iv.identity_state <> 'excluded' AND (iv.id::text = $1 OR ci.minecraft_id = $1)
       ORDER BY CASE WHEN iv.id::text = $1 THEN 0 ELSE 1 END, iv.created_at
       LIMIT 1`,
      [itemId],
    );
    const row = rows(result)[0];
    return row === undefined ? null : mapItem(row);
  }

  async listListings(itemId: string, input: PageInput): Promise<CursorPage<ListingRecord>> {
    const offset = normalizeCursor(input.cursor);
    const result = await this.options.queryable.query(
      `/* api.listListings */
       WITH requested_variant AS (
         SELECT iv.id FROM item_variants iv JOIN canonical_items ci ON ci.id = iv.canonical_item_id
         WHERE iv.id::text = $1 OR ci.minecraft_id = $1
         ORDER BY CASE WHEN iv.id::text = $1 THEN 0 ELSE 1 END LIMIT 1
       ), latest_snapshots AS (
         SELECT DISTINCT ON (source_id) id, source_id, status, consistency
         FROM listing_snapshots WHERE status <> 'failed'
         ORDER BY source_id, observed_at DESC
       )
       SELECT lo.id::text, lo.item_variant_id::text, lo.quantity,
              lo.total_ask_price::text, lo.unit_ask_price::text, lo.observed_at,
              lo.approximate_expires_at, lo.confidence, lo.flags,
              ls.status AS snapshot_status, ls.consistency AS snapshot_consistency,
              seller.current_name, seller.source_seller_id,
              source.source_key, source.source_type, run.collector_version,
              NULL::timestamptz AS source_timestamp, 'recent' AS freshness,
              CASE WHEN ls.status = 'complete' THEN 'complete' ELSE 'partial' END AS completeness,
              count(*) OVER()::text AS total_count
       FROM listing_observations lo
       JOIN requested_variant rv ON rv.id = lo.item_variant_id
       JOIN latest_snapshots ls ON ls.id = lo.snapshot_id
       JOIN sources source ON source.id = lo.source_id
       JOIN collection_runs run ON run.id = lo.run_id
       LEFT JOIN sellers seller ON seller.id = lo.seller_id
       ORDER BY lo.unit_ask_price, lo.observed_at DESC, lo.id
       LIMIT $2 OFFSET $3`,
      [itemId, input.limit, offset],
    );
    const mapped = rows(result).map(mapListing);
    const total = integer(rows(result)[0]?.total_count, 0);
    return { items: mapped, total, nextCursor: offset + mapped.length < total ? String(offset + mapped.length) : null };
  }

  async listSales(itemId: string, input: PageInput): Promise<CursorPage<SaleRecord>> {
    const offset = normalizeCursor(input.cursor);
    const result = await this.options.queryable.query(
      `/* api.listSales */
       WITH requested_variant AS (
         SELECT iv.id FROM item_variants iv JOIN canonical_items ci ON ci.id = iv.canonical_item_id
         WHERE iv.id::text = $1 OR ci.minecraft_id = $1
         ORDER BY CASE WHEN iv.id::text = $1 THEN 0 ELSE 1 END LIMIT 1
       )
       SELECT transaction.id::text, transaction.item_variant_id::text, transaction.quantity,
              transaction.total_price::text, transaction.unit_price::text,
              transaction.source_sold_at, transaction.last_observed_at,
              transaction.confidence, '{}'::jsonb AS flags,
              seller.current_name, seller.source_seller_id,
              source.source_key, source.source_type, 'unknown' AS collector_version,
              'recent' AS freshness, 'partial' AS completeness,
              count(*) OVER()::text AS total_count
       FROM logical_transactions transaction
       JOIN requested_variant rv ON rv.id = transaction.item_variant_id
       JOIN sources source ON source.id = transaction.source_id
       LEFT JOIN sellers seller ON seller.id = transaction.seller_id
       ORDER BY transaction.source_sold_at DESC, transaction.id
       LIMIT $2 OFFSET $3`,
      [itemId, input.limit, offset],
    );
    const mapped = rows(result).map(mapSale);
    const total = integer(rows(result)[0]?.total_count, 0);
    return { items: mapped, total, nextCursor: offset + mapped.length < total ? String(offset + mapped.length) : null };
  }

  async getHistory(itemId: string, input: HistoryInput): Promise<HistoryPoint[]> {
    const result = await this.options.queryable.query(
      `/* api.getHistory */
       WITH requested_variant AS (
         SELECT iv.id FROM item_variants iv JOIN canonical_items ci ON ci.id = iv.canonical_item_id
         WHERE iv.id::text = $1 OR ci.minecraft_id = $1
         ORDER BY CASE WHEN iv.id::text = $1 THEN 0 ELSE 1 END LIMIT 1
       )
       SELECT sale.bucket_start, sale.bucket_end, sale.interval_name,
              sale.open_price::text, sale.high_price::text, sale.low_price::text, sale.close_price::text,
              sale.median_price::text, sale.mean_price::text, sale.quantity_weighted_mean::text,
              sale.sample_count::text, sale.recorded_quantity::text, sale.recorded_turnover::text,
              ask.lowest_ask::text, ask.listing_count::text,
              sale.confidence, sale.completeness,
              source.source_key, source.source_type, sale.computation_version AS collector_version,
              sale.computed_at AS observed_at, sale.bucket_end AS source_timestamp
       FROM market_candles sale
       JOIN requested_variant rv ON rv.id = sale.item_variant_id
       JOIN sources source ON source.id = sale.source_id
       LEFT JOIN market_candles ask ON ask.source_id = sale.source_id
         AND ask.item_variant_id = sale.item_variant_id
         AND ask.interval_name = sale.interval_name AND ask.bucket_start = sale.bucket_start
         AND ask.market_side = 'active_ask' AND ask.computation_version = sale.computation_version
       WHERE sale.market_side = 'completed_sale' AND sale.interval_name = $2
         AND sale.bucket_start >= $3::timestamptz AND sale.bucket_start < $4::timestamptz
       ORDER BY sale.bucket_start, source.source_key
       LIMIT 20000`,
      [itemId, input.interval, input.from, input.to],
    );
    return rows(result).map((row) => ({
      start: requiredTimestamp(row.bucket_start, "bucket_start"),
      end: requiredTimestamp(row.bucket_end, "bucket_end"),
      interval: requiredText(row.interval_name, "interval") as HistoryPoint["interval"],
      open: text(row.open_price), high: text(row.high_price), low: text(row.low_price), close: text(row.close_price),
      median: text(row.median_price), mean: text(row.mean_price), quantityWeightedMean: text(row.quantity_weighted_mean),
      tradeCount: integer(row.sample_count), recordedQuantity: integer(row.recorded_quantity),
      recordedTurnover: text(row.recorded_turnover) ?? "0", lowestAsk: text(row.lowest_ask),
      activeListingCount: integer(row.listing_count), gap: row.completeness === "gapped",
      quality: qualityFromRow({ ...row, freshness: "recent" }),
      provenance: [provenanceFromRow(row)],
    }));
  }

  async getMarketOverview(): Promise<MarketOverview> {
    const result = await this.options.queryable.query(
      `/* api.getMarketOverview */
       WITH latest_snapshots AS (
         SELECT DISTINCT ON (source_id) id, observed_at, status
         FROM listing_snapshots WHERE status <> 'failed'
         ORDER BY source_id, observed_at DESC
       ), asks AS (
         SELECT count(*)::text AS listing_count, COALESCE(sum(lo.quantity), 0)::text AS listed_quantity,
                max(lo.observed_at) AS latest_at,
                bool_or(ls.status <> 'complete') AS partial
         FROM listing_observations lo JOIN latest_snapshots ls ON ls.id = lo.snapshot_id
       ), sales AS (
         SELECT count(*)::text AS trade_count, COALESCE(sum(quantity), 0)::text AS quantity,
                COALESCE(sum(total_price), 0)::text AS turnover, max(source_sold_at) AS latest_at
         FROM logical_transactions WHERE source_sold_at >= clock_timestamp() - interval '24 hours'
       ), gaps AS (
         SELECT count(*)::text AS count FROM data_gaps WHERE status = 'open'
       )
       SELECT asks.listing_count, asks.listed_quantity, asks.latest_at AS asks_latest_at, asks.partial,
              sales.trade_count, sales.quantity, sales.turnover, sales.latest_at AS sales_latest_at,
              gaps.count AS gap_count FROM asks, sales, gaps`,
    );
    const row = rows(result)[0] ?? {};
    const latest = Math.max(Date.parse(timestamp(row.asks_latest_at) ?? ""), Date.parse(timestamp(row.sales_latest_at) ?? ""));
    const age = Number.isFinite(latest) ? Date.now() - latest : Number.POSITIVE_INFINITY;
    const flags = [] as string[];
    if (row.partial === true) flags.push("partial_listing_snapshot");
    if (integer(row.gap_count) > 0) flags.push("historical_gap");
    return {
      generatedAt: new Date().toISOString(),
      activeAsks: { listingCount: integer(row.listing_count), listedQuantity: integer(row.listed_quantity) },
      completedSales: {
        recordedTradeCount24h: integer(row.trade_count),
        recordedQuantity24h: integer(row.quantity),
        recordedTurnover24h: text(row.turnover) ?? "0",
      },
      priceUnit: "server_currency",
      quality: {
        freshness: age <= 60_000 ? "live" : age <= 300_000 ? "recent" : Number.isFinite(age) ? "stale" : "unknown",
        confidence: integer(row.trade_count) > 0 && flags.length === 0 ? "medium" : "unknown",
        sampleSize: integer(row.trade_count),
        completeness: flags.length === 0 ? "complete_observation" : "partial",
        flags,
      },
      notices: ["Active asks are not completed sales.", "Recorded volume may not equal total market volume."],
    };
  }

  async listSources(): Promise<SourceHealth[]> {
    const result = await this.options.queryable.query(
      `/* api.listSources */
       SELECT source.id::text, source.source_key, source.source_type, source.display_name,
              source.enabled, source.trust_level, health.status, health.observed_at,
              health.metrics, health.reason,
              (SELECT max(requested_at) FROM source_requests request
               WHERE request.source_id = source.id AND request.error_code IS NOT NULL) AS last_failure_at,
              (SELECT error_code FROM source_requests request
               WHERE request.source_id = source.id AND request.error_code IS NOT NULL
               ORDER BY requested_at DESC LIMIT 1) AS last_error_code
       FROM sources source
       LEFT JOIN LATERAL (
         SELECT * FROM source_health_samples sample WHERE sample.source_id = source.id
         ORDER BY sample.observed_at DESC LIMIT 1
       ) health ON true
       ORDER BY source.source_key`,
    );
    return rows(result).map((row) => {
      const status = row.enabled !== true ? "disabled"
        : row.status === "healthy" ? "healthy"
          : row.status === "delayed" ? "stale"
            : row.status === "throttled" || row.status === "degraded" ? "degraded"
              : row.status === "offline" || row.status === "unauthorized" ? "offline" : "unknown";
      const trust = row.trust_level === "authoritative" || row.trust_level === "compatible"
        ? "primary" : row.trust_level === "community" ? "community" : "unknown";
      const metrics = object(row.metrics);
      return {
        id: requiredText(row.source_key ?? row.id, "source key"),
        type: requiredText(row.source_type, "source type"),
        displayName: requiredText(row.display_name, "source name"),
        enabled: row.enabled === true,
        trust,
        status,
        lastSuccessAt: row.status === "healthy" ? timestamp(row.observed_at) : null,
        lastFailureAt: timestamp(row.last_failure_at),
        lastErrorCode: text(row.last_error_code),
        requestLatencyMs: metrics.latencyMs === undefined ? null : integer(metrics.latencyMs),
        freshness: status === "healthy" ? "live" : status === "stale" || status === "degraded" ? "stale" : "unknown",
      } satisfies SourceHealth;
    });
  }

  async getCollectionHealth(): Promise<CollectionHealth> {
    const result = await this.options.queryable.query(
      `/* api.getCollectionHealth */
       SELECT
         (SELECT EXTRACT(EPOCH FROM (clock_timestamp() - min(started_at)))::bigint::text
          FROM collection_runs WHERE status = 'running') AS collector_uptime_seconds,
         (SELECT max(completed_at) FROM collection_runs WHERE status IN ('succeeded', 'partial')) AS last_success_at,
         (SELECT max(source_sold_at) FROM logical_transactions) AS last_transaction_at,
         (SELECT min(source_sold_at) FROM (
            SELECT source_sold_at FROM logical_transactions ORDER BY source_sold_at DESC LIMIT 1000
          ) window) AS transaction_window_oldest_at,
         (SELECT count(*)::text FROM source_requests WHERE requested_at >= clock_timestamp() - interval '1 minute') AS requests_per_minute,
         (SELECT count(*)::text FROM source_requests WHERE requested_at >= clock_timestamp() - interval '24 hours'
          AND (http_status >= 500 OR error_code IS NOT NULL)) AS upstream_errors,
         (SELECT count(*)::text FROM source_requests WHERE requested_at >= clock_timestamp() - interval '24 hours'
          AND (http_status IN (401,403) OR error_code ILIKE '%auth%')) AS authentication_errors,
         (SELECT count(*)::text FROM source_requests WHERE requested_at >= clock_timestamp() - interval '24 hours'
          AND (http_status = 429 OR error_code ILIKE '%rate%')) AS throttling_events,
         (SELECT COALESCE(sum(duplicate_count),0)::text FROM collection_runs
          WHERE started_at >= clock_timestamp() - interval '24 hours') AS duplicates,
         (SELECT COALESCE(sum(invalid_count),0)::text FROM collection_runs
          WHERE started_at >= clock_timestamp() - interval '24 hours') AS invalid_records,
         (SELECT count(*)::text FROM item_variants
          WHERE identity_state IN ('incomplete','ambiguous','unclassified')
            AND created_at >= clock_timestamp() - interval '24 hours') AS missing_metadata,
         (SELECT count(*)::text FROM data_gaps WHERE status = 'open') AS gap_count,
         (SELECT GREATEST(0, EXTRACT(EPOCH FROM (clock_timestamp() - min(next_run_at))) * 1000)::bigint::text
          FROM collector_checkpoints WHERE next_run_at < clock_timestamp()) AS worker_delay_ms`,
    );
    const row = rows(result)[0] ?? {};
    const flags = integer(row.gap_count) > 0 ? ["historical_gap"] : [];
    return {
      generatedAt: new Date().toISOString(),
      collectorUptimeSeconds: row.collector_uptime_seconds === null ? null : integer(row.collector_uptime_seconds),
      lastSuccessfulRequestAt: timestamp(row.last_success_at),
      lastNewTransactionAt: timestamp(row.last_transaction_at),
      transactionWindowOldestAt: timestamp(row.transaction_window_oldest_at),
      requestsPerMinute: integer(row.requests_per_minute),
      upstreamErrors24h: integer(row.upstream_errors),
      authenticationErrors24h: integer(row.authentication_errors),
      throttlingEvents24h: integer(row.throttling_events),
      duplicates24h: integer(row.duplicates),
      invalidRecords24h: integer(row.invalid_records),
      missingMetadata24h: integer(row.missing_metadata),
      historicalGapCount: integer(row.gap_count),
      workerDelayMs: row.worker_delay_ms === null ? null : integer(row.worker_delay_ms),
      backupState: "unknown",
      quality: {
        freshness: timestamp(row.last_success_at) === null ? "unknown" : "recent",
        confidence: "medium",
        sampleSize: null,
        completeness: flags.length === 0 ? "complete_observation" : "partial",
        flags: [...flags, "backup_state_unavailable"],
      },
    };
  }

  async listFeatures(): Promise<FeatureAvailability[]> {
    const result = await this.options.queryable.query(
      `/* api.listFeatures */
       SELECT feature.feature_key, feature.status, feature.reason, feature.updated_at,
              source.source_key FROM feature_availability feature
       LEFT JOIN sources source ON source.id = feature.source_id
       ORDER BY feature.updated_at DESC`,
    );
    const checkedAt = new Date().toISOString();
    const defaults: FeatureAvailability[] = [
      { id: "auction_listings", state: "available", reason: "Compatible API adapter supported", sourceId: "compatible-api", checkedAt },
      { id: "completed_sales", state: "available", reason: "Compatible API adapter supported", sourceId: "compatible-api", checkedAt },
      { id: "orders", state: "unavailable", reason: "No verified provider exists", sourceId: null, checkedAt },
      { id: "shop_prices", state: "unavailable", reason: "No verified provider exists", sourceId: null, checkedAt },
      { id: "fees", state: "unknown", reason: "No enabled effective-dated fee evidence exists", sourceId: null, checkedAt },
      { id: "buyer_data", state: "unavailable", reason: "The compatible API has no buyer field", sourceId: null, checkedAt },
      { id: "client_observation", state: "disabled", reason: "Requires separate authorization and validation", sourceId: null, checkedAt },
      { id: "automated_actions", state: "disabled", reason: "Outside the initial product", sourceId: null, checkedAt },
    ];
    const supported = new Set<string>(defaults.map((feature) => feature.id));
    const overrides = new Map<string, Row>();
    for (const row of rows(result)) if (supported.has(String(row.feature_key))) overrides.set(String(row.feature_key), row);
    return defaults.map((feature) => {
      const row = overrides.get(feature.id);
      if (row === undefined) return feature;
      const state = row.status === "available" ? "available"
        : row.status === "disabled" ? "disabled"
          : row.status === "degraded" ? "unknown" : "unavailable";
      return {
        ...feature,
        state,
        reason: requiredText(row.reason, "feature reason"),
        sourceId: text(row.source_key),
        checkedAt: requiredTimestamp(row.updated_at, "feature updated_at"),
      };
    });
  }

  private async resolveItem(queryable: Queryable, itemId: string): Promise<{ canonicalId: string; variantId: string | null } | null> {
    const result = await queryable.query(
      `/* api.resolveItem */
       SELECT ci.id::text AS canonical_id,
              CASE WHEN iv.id::text = $1 THEN iv.id::text ELSE NULL END AS variant_id
       FROM canonical_items ci LEFT JOIN item_variants iv ON iv.canonical_item_id = ci.id
       WHERE ci.minecraft_id = $1 OR iv.id::text = $1
       ORDER BY CASE WHEN iv.id::text = $1 THEN 0 ELSE 1 END LIMIT 1`,
      [itemId],
    );
    const row = rows(result)[0];
    return row === undefined ? null : {
      canonicalId: requiredText(row.canonical_id, "canonical item id"),
      variantId: text(row.variant_id),
    };
  }

  private async replaceWatchlistItems(queryable: Queryable, watchlistId: string, itemIds: string[]): Promise<void> {
    await queryable.query(`/* api.clearWatchlistItems */ DELETE FROM watchlist_items WHERE watchlist_id::text = $1`, [watchlistId]);
    for (const itemId of itemIds) {
      const resolved = await this.resolveItem(queryable, itemId);
      if (resolved === null) throw new RepositoryError("CONFLICT", `Unknown watchlist item: ${itemId}`);
      await queryable.query(
        `/* api.insertWatchlistItem */
         INSERT INTO watchlist_items (id, watchlist_id, canonical_item_id, item_variant_id)
         VALUES ($1, $2, $3, $4)`,
        [randomUUID(), watchlistId, resolved.canonicalId, resolved.variantId],
      );
    }
  }

  private mapWatchlist(row: Row): Watchlist {
    return {
      id: requiredText(row.id, "watchlist id"), userId: requiredText(row.user_id, "watchlist user id"),
      name: requiredText(row.name, "watchlist name"), itemIds: stringArray(row.item_ids),
      createdAt: requiredTimestamp(row.created_at, "created_at"), updatedAt: requiredTimestamp(row.updated_at, "updated_at"),
    };
  }

  async listWatchlists(userId: string): Promise<Watchlist[]> {
    const result = await this.options.queryable.query(
      `/* api.listWatchlists */
       SELECT watchlist.id::text, watchlist.user_id::text, watchlist.name,
              watchlist.created_at, watchlist.updated_at,
              COALESCE(array_agg(COALESCE(item.item_variant_id::text, canonical.minecraft_id)
                ORDER BY COALESCE(item.item_variant_id::text, canonical.minecraft_id))
                FILTER (WHERE item.id IS NOT NULL), ARRAY[]::text[]) AS item_ids
       FROM watchlists watchlist
       LEFT JOIN watchlist_items item ON item.watchlist_id = watchlist.id
       LEFT JOIN canonical_items canonical ON canonical.id = item.canonical_item_id
       WHERE watchlist.user_id::text = $1
       GROUP BY watchlist.id ORDER BY watchlist.updated_at DESC`,
      [userId],
    );
    return rows(result).map((row) => this.mapWatchlist(row));
  }

  async createWatchlist(userId: string, input: CreateWatchlistInput): Promise<Watchlist> {
    return this.options.database.withTransaction(async (client) => {
      const id = randomUUID();
      const result = await client.query(
        `/* api.createWatchlist */
         INSERT INTO watchlists (id, user_id, name) VALUES ($1, $2, $3)
         RETURNING id::text, user_id::text, name, created_at, updated_at`,
        [id, userId, input.name],
      );
      await this.replaceWatchlistItems(client, id, input.itemIds);
      return this.mapWatchlist({ ...rows(result)[0], item_ids: input.itemIds });
    });
  }

  async updateWatchlist(userId: string, id: string, input: CreateWatchlistInput): Promise<Watchlist | null> {
    return this.options.database.withTransaction(async (client) => {
      const result = await client.query(
        `/* api.updateWatchlist */
         UPDATE watchlists SET name = $3, updated_at = clock_timestamp()
         WHERE id::text = $2 AND user_id::text = $1
         RETURNING id::text, user_id::text, name, created_at, updated_at`,
        [userId, id, input.name],
      );
      if (rows(result)[0] === undefined) return null;
      await this.replaceWatchlistItems(client, id, input.itemIds);
      return this.mapWatchlist({ ...rows(result)[0], item_ids: input.itemIds });
    });
  }

  async deleteWatchlist(userId: string, id: string): Promise<boolean> {
    const result = await this.options.queryable.query(
      `/* api.deleteWatchlist */ DELETE FROM watchlists WHERE id::text = $2 AND user_id::text = $1`, [userId, id],
    );
    return result.rowCount === 1;
  }

  private mapAlert(row: Row): AlertRule {
    const parameters = object(row.parameters);
    return {
      id: requiredText(row.id, "alert id"), userId: requiredText(row.user_id, "alert user id"),
      name: text(parameters.name) ?? requiredText(row.rule_type, "alert type"),
      type: requiredText(row.rule_type, "alert type") as AlertRule["type"],
      itemId: text(row.item_variant_id ?? row.minecraft_id), threshold: text(parameters.threshold),
      percentage: typeof parameters.percentage === "number" ? parameters.percentage : null,
      cooldownSeconds: integer(row.cooldown_seconds, 300), enabled: row.enabled === true,
      createdAt: requiredTimestamp(row.created_at, "created_at"), updatedAt: requiredTimestamp(row.updated_at, "updated_at"),
    };
  }

  async listAlerts(userId: string): Promise<AlertRule[]> {
    const result = await this.options.queryable.query(
      `/* api.listAlerts */
       SELECT alert.id::text, alert.user_id::text, alert.rule_type, alert.parameters,
              alert.item_variant_id::text, canonical.minecraft_id, alert.enabled,
              alert.cooldown_seconds, alert.created_at, alert.updated_at
       FROM alert_rules alert LEFT JOIN canonical_items canonical ON canonical.id = alert.canonical_item_id
       WHERE alert.user_id::text = $1 ORDER BY alert.updated_at DESC`, [userId],
    );
    return rows(result).map((row) => this.mapAlert(row));
  }

  private async alertItem(queryable: Queryable, itemId: string | null) {
    if (itemId === null) return { canonicalId: null, variantId: null };
    const resolved = await this.resolveItem(queryable, itemId);
    if (resolved === null) throw new RepositoryError("CONFLICT", `Unknown alert item: ${itemId}`);
    return resolved;
  }

  async createAlert(userId: string, input: CreateAlertInput): Promise<AlertRule> {
    return this.options.database.withTransaction(async (client) => {
      const item = await this.alertItem(client, input.itemId);
      const result = await client.query(
        `/* api.createAlert */
         INSERT INTO alert_rules (id, user_id, canonical_item_id, item_variant_id, rule_type, parameters, enabled, cooldown_seconds)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
         RETURNING id::text, user_id::text, rule_type, parameters, item_variant_id::text,
                   enabled, cooldown_seconds, created_at, updated_at`,
        [randomUUID(), userId, item.canonicalId, item.variantId, input.type,
          JSON.stringify({ name: input.name, threshold: input.threshold, percentage: input.percentage }),
          input.enabled, input.cooldownSeconds],
      );
      return this.mapAlert({ ...rows(result)[0], minecraft_id: input.itemId });
    });
  }

  async updateAlert(userId: string, id: string, input: CreateAlertInput): Promise<AlertRule | null> {
    return this.options.database.withTransaction(async (client) => {
      const item = await this.alertItem(client, input.itemId);
      const result = await client.query(
        `/* api.updateAlert */
         UPDATE alert_rules SET canonical_item_id = $3, item_variant_id = $4, rule_type = $5,
           parameters = $6::jsonb, enabled = $7, cooldown_seconds = $8, updated_at = clock_timestamp()
         WHERE user_id::text = $1 AND id::text = $2
         RETURNING id::text, user_id::text, rule_type, parameters, item_variant_id::text,
                   enabled, cooldown_seconds, created_at, updated_at`,
        [userId, id, item.canonicalId, item.variantId, input.type,
          JSON.stringify({ name: input.name, threshold: input.threshold, percentage: input.percentage }),
          input.enabled, input.cooldownSeconds],
      );
      const row = rows(result)[0];
      return row === undefined ? null : this.mapAlert({ ...row, minecraft_id: input.itemId });
    });
  }

  async deleteAlert(userId: string, id: string): Promise<boolean> {
    const result = await this.options.queryable.query(
      `/* api.deleteAlert */ DELETE FROM alert_rules WHERE user_id::text = $1 AND id::text = $2`, [userId, id],
    );
    return result.rowCount === 1;
  }

  private mapDashboard(row: Row): Dashboard {
    const layout = object(row.layout);
    const cards = Array.isArray(layout.cards)
      ? layout.cards.filter((card): card is DashboardCard => card !== null && typeof card === "object")
      : [];
    const theme = layout.theme === "light" || layout.theme === "dark" ? layout.theme : "system";
    const density = layout.density === "compact" ? "compact" : "comfortable";
    return {
      id: requiredText(row.id, "dashboard id"), userId: requiredText(row.user_id, "dashboard user id"),
      name: requiredText(row.name, "dashboard name"), cards, theme, density,
      createdAt: requiredTimestamp(row.created_at, "created_at"), updatedAt: requiredTimestamp(row.updated_at, "updated_at"),
    };
  }

  async listDashboards(userId: string): Promise<Dashboard[]> {
    const result = await this.options.queryable.query(
      `/* api.listDashboards */
       SELECT id::text, user_id::text, name, layout, created_at, updated_at
       FROM dashboard_layouts WHERE user_id::text = $1 ORDER BY updated_at DESC`, [userId],
    );
    return rows(result).map((row) => this.mapDashboard(row));
  }

  async createDashboard(userId: string, input: CreateDashboardInput): Promise<Dashboard> {
    const result = await this.options.queryable.query(
      `/* api.createDashboard */
       INSERT INTO dashboard_layouts (id, user_id, name, layout)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING id::text, user_id::text, name, layout, created_at, updated_at`,
      [randomUUID(), userId, input.name, JSON.stringify({ cards: input.cards, theme: input.theme, density: input.density })],
    );
    return this.mapDashboard(rows(result)[0] ?? {});
  }

  async updateDashboard(userId: string, id: string, input: CreateDashboardInput): Promise<Dashboard | null> {
    const result = await this.options.queryable.query(
      `/* api.updateDashboard */
       UPDATE dashboard_layouts SET name = $3, layout = $4::jsonb, layout_version = layout_version + 1,
         updated_at = clock_timestamp()
       WHERE user_id::text = $1 AND id::text = $2
       RETURNING id::text, user_id::text, name, layout, created_at, updated_at`,
      [userId, id, input.name, JSON.stringify({ cards: input.cards, theme: input.theme, density: input.density })],
    );
    const row = rows(result)[0];
    return row === undefined ? null : this.mapDashboard(row);
  }

  async deleteDashboard(userId: string, id: string): Promise<boolean> {
    const result = await this.options.queryable.query(
      `/* api.deleteDashboard */ DELETE FROM dashboard_layouts WHERE user_id::text = $1 AND id::text = $2`, [userId, id],
    );
    return result.rowCount === 1;
  }

  async exportUserData(userId: string): Promise<ExportBundle> {
    const items: ItemDetail[] = [];
    const listings: ListingRecord[] = [];
    const sales: SaleRecord[] = [];
    let itemCursor: string | null = null;
    do {
      const page = await this.searchItems({ query: "", cursor: itemCursor, limit: 100 });
      for (const summary of page.items) {
        const detail = await this.getItem(summary.id);
        if (detail !== null) items.push(detail);
        let listingCursor: string | null = null;
        do {
          const listingPage = await this.listListings(summary.id, { cursor: listingCursor, limit: 100 });
          listings.push(...listingPage.items);
          listingCursor = listingPage.nextCursor;
          if (listings.length > 100_000) throw new RepositoryError("UNAVAILABLE", "Synchronous export exceeds 100,000 listings");
        } while (listingCursor !== null);
        let saleCursor: string | null = null;
        do {
          const salePage = await this.listSales(summary.id, { cursor: saleCursor, limit: 100 });
          sales.push(...salePage.items);
          saleCursor = salePage.nextCursor;
          if (sales.length > 100_000) throw new RepositoryError("UNAVAILABLE", "Synchronous export exceeds 100,000 sales");
        } while (saleCursor !== null);
      }
      itemCursor = page.nextCursor;
      if (items.length > 20_000) throw new RepositoryError("UNAVAILABLE", "Synchronous export exceeds 20,000 item variants");
    } while (itemCursor !== null);
    return {
      generatedAt: new Date().toISOString(), items, listings, sales,
      watchlists: await this.listWatchlists(userId), alerts: await this.listAlerts(userId),
      dashboards: await this.listDashboards(userId),
    };
  }

  private mapOutbox(event: DatabaseOutboxEvent): OutboxEvent | null {
    if (event.audience !== "owner" && event.audience !== "authenticated") return null;
    const type: OutboxEvent["type"] = event.eventType === "market.transaction.recorded" ? "sale.recorded"
      : event.eventType === "market.listing.changed" ? "listing.changed"
        : event.eventType === "market.summary" ? "market.summary"
          : event.eventType === "alert.triggered" ? "alert.triggered"
            : event.eventType === "source.health" ? "source.health"
              : event.eventType === "gap.detected" ? "gap.detected" : "system.event";
    const payload = type === "system.event"
      ? {
          eventType: event.eventType,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          ...event.payload,
        }
      : event.payload as Record<string, unknown>;
    return {
      cursor: event.cursor,
      audience: event.audience,
      type,
      occurredAt: event.occurredAt.toISOString(),
      payload,
    };
  }

  async readOutbox(
    afterCursor: string | null,
    limit: number,
    audiences: readonly OutboxEvent["audience"][],
  ): Promise<OutboxEvent[]> {
    const cursor = String(normalizeCursor(afterCursor));
    const events = await this.options.database.readOutbox(cursor, Math.min(limit, 1000), audiences);
    return events.map((event) => this.mapOutbox(event)).filter((event): event is OutboxEvent => event !== null).slice(0, limit);
  }

  subscribeOutbox(
    listener: (event: OutboxEvent) => void,
    audiences: readonly OutboxEvent["audience"][],
  ): () => void {
    this.listeners.set(listener, new Set(audiences));
    this.schedulePoll(0);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.pollTimer !== null) {
        clearTimeout(this.pollTimer);
        this.pollTimer = null;
      }
    };
  }

  private schedulePoll(delay = this.options.outboxPollMs ?? 1000): void {
    if (this.closed || this.listeners.size === 0 || this.pollTimer !== null) return;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void this.pollOutbox();
    }, delay);
    this.pollTimer.unref();
  }

  private async pollOutbox(): Promise<void> {
    if (this.pollInFlight || this.closed || this.listeners.size === 0) return;
    this.pollInFlight = true;
    try {
      const requestedAudiences = new Set<OutboxEvent["audience"]>();
      for (const audiences of this.listeners.values()) for (const audience of audiences) requestedAudiences.add(audience);
      const events = await this.options.database.readOutbox(this.outboxCursor, 1000, [...requestedAudiences]);
      for (const raw of events) {
        this.outboxCursor = raw.cursor;
        const event = this.mapOutbox(raw);
        if (event === null) continue;
        for (const [listener, audiences] of this.listeners) if (audiences.has(event.audience)) listener(event);
      }
      this.schedulePoll(events.length === 1000 ? 0 : undefined);
    } catch {
      this.schedulePoll(Math.max(this.options.outboxPollMs ?? 1000, 5000));
    } finally {
      this.pollInFlight = false;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.pollTimer !== null) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    this.listeners.clear();
    await this.options.database.close();
  }
}

export async function createPostgresMarketRepository(
  options: CreatePostgresRepositoryOptions,
): Promise<PostgresMarketRepository> {
  const pool = createDatabasePool({
    connectionString: options.connectionString,
    applicationName: "donut-api",
    maxConnections: options.maxConnections ?? 10,
    ssl: options.ssl,
  });
  const database = new DatabaseMarketRepository(pool);
  try {
    await pool.query(
      `/* api.ensureOwner */
       INSERT INTO users (
         id, email_normalized, display_name, role, status, password_hash, seller_visibility
       ) VALUES ($1, lower($2), $2, 'owner', 'active', $3, 'full')
       ON CONFLICT (role) WHERE role = 'owner' DO UPDATE SET
         email_normalized = EXCLUDED.email_normalized,
         display_name = EXCLUDED.display_name,
         status = 'active',
         password_hash = EXCLUDED.password_hash,
         seller_visibility = 'full',
         updated_at = clock_timestamp()`,
      [randomUUID(), options.ownerUsername, options.ownerPasswordHash],
    );
    const baseline = await pool.query<{ cursor: string }>(
      `/* api.initialOutboxCursor */ SELECT COALESCE(max(sequence_id), 0)::text AS cursor FROM outbox_events`,
    );
    return new PostgresMarketRepository({
      queryable: pool,
      database,
      initialOutboxCursor: baseline.rows[0]?.cursor ?? "0",
      outboxPollMs: options.outboxPollMs,
    });
  } catch (error) {
    await database.close();
    throw error;
  }
}
