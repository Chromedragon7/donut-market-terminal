export type UserRole = "owner" | "invited";
export type SellerPrivacyPolicy = "full" | "name" | "pseudonymized" | "hidden";
export type ConfidenceLevel = "high" | "medium" | "low" | "unknown";
export type FreshnessState = "live" | "recent" | "stale" | "unknown";

export interface User {
  id: string;
  username: string;
  role: UserRole;
  sellerPrivacy: SellerPrivacyPolicy;
}

export interface StoredUser {
  user: User;
  passwordHash: string;
}

export interface StoredSession {
  id: string;
  userId: string;
  tokenHash: string;
  csrfHash: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export type ModScope = "market:read" | "stream:read";

export interface StoredModToken {
  id: string;
  userId: string;
  label: string;
  tokenHash: string;
  scopes: ModScope[];
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface Provenance {
  sourceId: string;
  sourceType: "compatible_api" | "client_observation" | "manual" | "derived";
  observedAt: string;
  sourceTimestamp: string | null;
  collectorVersion: string;
}

export interface DataQuality {
  freshness: FreshnessState;
  confidence: ConfidenceLevel;
  sampleSize: number | null;
  completeness: "complete_observation" | "partial" | "unknown";
  flags: string[];
}

export interface SellerRecord {
  name: string | null;
  uuid: string | null;
}

export interface ItemSummary {
  id: string;
  baseItemId: string;
  displayName: string;
  variantLabel: string | null;
  identityState: "exact" | "strong" | "broad" | "incomplete" | "ambiguous" | "unclassified";
  lowestAsk: string | null;
  recentSaleMedian: string | null;
  priceUnit: "server_currency";
  quality: DataQuality;
}

export interface ItemDetail extends ItemSummary {
  description: string | null;
  metadata: Record<string, unknown>;
  recordedSaleCount: number;
  activeListingCount: number;
}

export interface ListingRecord {
  id: string;
  itemId: string;
  quantity: number;
  totalAsk: string;
  unitAsk: string;
  priceUnit: "server_currency";
  observedAt: string;
  remainingSeconds: number | null;
  seller: SellerRecord;
  provenance: Provenance;
  quality: DataQuality;
}

export interface SaleRecord {
  id: string;
  itemId: string;
  quantity: number;
  totalSale: string;
  unitSale: string;
  priceUnit: "server_currency";
  soldAt: string;
  ingestedAt: string;
  seller: SellerRecord;
  provenance: Provenance;
  quality: DataQuality;
}

export interface HistoryPoint {
  start: string;
  end: string;
  interval: "minute" | "five_minute" | "hour" | "day" | "week";
  open: string | null;
  high: string | null;
  low: string | null;
  close: string | null;
  median: string | null;
  mean: string | null;
  quantityWeightedMean: string | null;
  tradeCount: number;
  recordedQuantity: number;
  recordedTurnover: string;
  lowestAsk: string | null;
  activeListingCount: number;
  gap: boolean;
  quality: DataQuality;
  provenance: Provenance[];
}

export interface MarketOverview {
  generatedAt: string;
  activeAsks: {
    listingCount: number;
    listedQuantity: number;
  };
  completedSales: {
    recordedTradeCount24h: number;
    recordedQuantity24h: number;
    recordedTurnover24h: string;
  };
  priceUnit: "server_currency";
  quality: DataQuality;
  notices: string[];
}

export interface SourceHealth {
  id: string;
  type: string;
  displayName: string;
  enabled: boolean;
  trust: "primary" | "community" | "manual" | "unknown";
  status: "healthy" | "degraded" | "stale" | "offline" | "disabled" | "unknown";
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastErrorCode: string | null;
  requestLatencyMs: number | null;
  freshness: FreshnessState;
}

export interface CollectionHealth {
  generatedAt: string;
  collectorUptimeSeconds: number | null;
  lastSuccessfulRequestAt: string | null;
  lastNewTransactionAt: string | null;
  transactionWindowOldestAt: string | null;
  requestsPerMinute: number | null;
  upstreamErrors24h: number;
  authenticationErrors24h: number;
  throttlingEvents24h: number;
  duplicates24h: number;
  invalidRecords24h: number;
  missingMetadata24h: number;
  historicalGapCount: number;
  workerDelayMs: number | null;
  backupState: "healthy" | "overdue" | "failed" | "unknown";
  quality: DataQuality;
}

export type FeatureState = "available" | "disabled" | "unavailable" | "unknown";

export interface FeatureAvailability {
  id: "auction_listings" | "completed_sales" | "orders" | "shop_prices" | "fees" | "buyer_data" | "client_observation" | "automated_actions";
  state: FeatureState;
  reason: string;
  sourceId: string | null;
  checkedAt: string;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  total: number | null;
}

export interface Watchlist {
  id: string;
  userId: string;
  name: string;
  itemIds: string[];
  createdAt: string;
  updatedAt: string;
}

export type AlertType = "ask_below" | "ask_below_median_percent" | "sale_threshold" | "price_movement" | "volume_spike" | "supply_change" | "new_variant" | "source_stale" | "collector_failure" | "historical_gap" | "low_confidence";

export interface AlertRule {
  id: string;
  userId: string;
  name: string;
  type: AlertType;
  itemId: string | null;
  threshold: string | null;
  percentage: number | null;
  cooldownSeconds: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardCard {
  id: string;
  type: "market_summary" | "item_price" | "price_chart" | "volume" | "supply" | "source_health" | "watchlist";
  itemId: string | null;
  metric: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Dashboard {
  id: string;
  userId: string;
  name: string;
  cards: DashboardCard[];
  theme: "system" | "light" | "dark";
  density: "compact" | "comfortable";
  createdAt: string;
  updatedAt: string;
}

export interface OutboxEvent {
  cursor: string;
  audience: "owner" | "authenticated";
  type: "listing.changed" | "sale.recorded" | "market.summary" | "alert.triggered" | "source.health" | "gap.detected" | "system.event";
  occurredAt: string;
  payload: Record<string, unknown>;
}

export interface ExportBundle {
  generatedAt: string;
  items: ItemDetail[];
  listings: ListingRecord[];
  sales: SaleRecord[];
  watchlists: Watchlist[];
  alerts: AlertRule[];
  dashboards: Dashboard[];
}

export interface ReadinessResult {
  ready: boolean;
  checks: Record<string, "ready" | "not_ready" | "unknown">;
}

export interface ItemSearchInput {
  query: string;
  cursor: string | null;
  limit: number;
}

export interface PageInput {
  cursor: string | null;
  limit: number;
}

export interface HistoryInput {
  from: string;
  to: string;
  interval: HistoryPoint["interval"];
  includeOutliers: boolean;
}

export interface CreateWatchlistInput {
  name: string;
  itemIds: string[];
}

export interface CreateAlertInput {
  name: string;
  type: AlertType;
  itemId: string | null;
  threshold: string | null;
  percentage: number | null;
  cooldownSeconds: number;
  enabled: boolean;
}

export interface CreateDashboardInput {
  name: string;
  cards: DashboardCard[];
  theme: Dashboard["theme"];
  density: Dashboard["density"];
}

export interface CreateModTokenInput {
  id: string;
  userId: string;
  label: string;
  tokenHash: string;
  scopes: ModScope[];
  createdAt: string;
  expiresAt: string | null;
}

export interface MarketRepository {
  readiness(): Promise<ReadinessResult>;
  findUserByUsername(username: string): Promise<StoredUser | null>;
  findUserById(userId: string): Promise<User | null>;
  createSession(session: StoredSession): Promise<void>;
  findSessionByTokenHash(tokenHash: string): Promise<StoredSession | null>;
  revokeSession(sessionId: string, revokedAt: string): Promise<void>;
  createModToken(input: CreateModTokenInput): Promise<void>;
  findModTokenByHash(tokenHash: string): Promise<StoredModToken | null>;
  listModTokens(userId: string): Promise<StoredModToken[]>;
  revokeModToken(userId: string, tokenId: string, revokedAt: string): Promise<boolean>;
  getMarketOverview(): Promise<MarketOverview>;
  searchItems(input: ItemSearchInput): Promise<CursorPage<ItemSummary>>;
  getItem(itemId: string): Promise<ItemDetail | null>;
  listListings(itemId: string, input: PageInput): Promise<CursorPage<ListingRecord>>;
  listSales(itemId: string, input: PageInput): Promise<CursorPage<SaleRecord>>;
  getHistory(itemId: string, input: HistoryInput): Promise<HistoryPoint[]>;
  listSources(): Promise<SourceHealth[]>;
  getCollectionHealth(): Promise<CollectionHealth>;
  listFeatures(): Promise<FeatureAvailability[]>;
  listWatchlists(userId: string): Promise<Watchlist[]>;
  createWatchlist(userId: string, input: CreateWatchlistInput): Promise<Watchlist>;
  updateWatchlist(userId: string, id: string, input: CreateWatchlistInput): Promise<Watchlist | null>;
  deleteWatchlist(userId: string, id: string): Promise<boolean>;
  listAlerts(userId: string): Promise<AlertRule[]>;
  createAlert(userId: string, input: CreateAlertInput): Promise<AlertRule>;
  updateAlert(userId: string, id: string, input: CreateAlertInput): Promise<AlertRule | null>;
  deleteAlert(userId: string, id: string): Promise<boolean>;
  listDashboards(userId: string): Promise<Dashboard[]>;
  createDashboard(userId: string, input: CreateDashboardInput): Promise<Dashboard>;
  updateDashboard(userId: string, id: string, input: CreateDashboardInput): Promise<Dashboard | null>;
  deleteDashboard(userId: string, id: string): Promise<boolean>;
  exportUserData(userId: string): Promise<ExportBundle>;
  readOutbox(
    afterCursor: string | null,
    limit: number,
    audiences: readonly OutboxEvent["audience"][],
  ): Promise<OutboxEvent[]>;
  subscribeOutbox(
    listener: (event: OutboxEvent) => void,
    audiences: readonly OutboxEvent["audience"][],
  ): () => void;
}

export interface CloseableMarketRepository extends MarketRepository {
  close(): Promise<void>;
}

export class RepositoryError extends Error {
  constructor(
    public readonly code: "INVALID_CURSOR" | "CONFLICT" | "UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "RepositoryError";
  }
}
