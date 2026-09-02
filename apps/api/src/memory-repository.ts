import { randomUUID } from "node:crypto";
import type {
  AlertRule,
  CollectionHealth,
  CreateAlertInput,
  CreateDashboardInput,
  CreateModTokenInput,
  CreateWatchlistInput,
  CursorPage,
  Dashboard,
  ExportBundle,
  FeatureAvailability,
  HistoryInput,
  HistoryPoint,
  ItemDetail,
  ItemSearchInput,
  ItemSummary,
  ListingRecord,
  MarketOverview,
  MarketRepository,
  OutboxEvent,
  PageInput,
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

export interface MemoryRepositorySeed {
  users?: StoredUser[];
  overview?: MarketOverview;
  items?: ItemDetail[];
  listings?: ListingRecord[];
  sales?: SaleRecord[];
  history?: Record<string, HistoryPoint[]>;
  sources?: SourceHealth[];
  collectionHealth?: CollectionHealth;
  features?: FeatureAvailability[];
  outbox?: OutboxEvent[];
  ready?: boolean;
}

const clone = <T>(value: T): T => structuredClone(value);

function nowIso(): string {
  return new Date().toISOString();
}

function defaultQuality() {
  return {
    freshness: "unknown" as const,
    confidence: "unknown" as const,
    sampleSize: null,
    completeness: "unknown" as const,
    flags: ["no_collector_data"],
  };
}

function defaultOverview(): MarketOverview {
  return {
    generatedAt: nowIso(),
    activeAsks: { listingCount: 0, listedQuantity: 0 },
    completedSales: {
      recordedTradeCount24h: 0,
      recordedQuantity24h: 0,
      recordedTurnover24h: "0",
    },
    priceUnit: "server_currency",
    quality: defaultQuality(),
    notices: [
      "Active asks are not completed sales.",
      "Recorded volume may not equal total market volume.",
    ],
  };
}

function defaultCollectionHealth(): CollectionHealth {
  return {
    generatedAt: nowIso(),
    collectorUptimeSeconds: null,
    lastSuccessfulRequestAt: null,
    lastNewTransactionAt: null,
    transactionWindowOldestAt: null,
    requestsPerMinute: null,
    upstreamErrors24h: 0,
    authenticationErrors24h: 0,
    throttlingEvents24h: 0,
    duplicates24h: 0,
    invalidRecords24h: 0,
    missingMetadata24h: 0,
    historicalGapCount: 0,
    workerDelayMs: null,
    backupState: "unknown",
    quality: defaultQuality(),
  };
}

function defaultFeatures(): FeatureAvailability[] {
  const checkedAt = nowIso();
  return [
    { id: "auction_listings", state: "available", reason: "Compatible API adapter supported", sourceId: "compatible-api", checkedAt },
    { id: "completed_sales", state: "available", reason: "Compatible API adapter supported", sourceId: "compatible-api", checkedAt },
    { id: "orders", state: "unavailable", reason: "The documented compatible API does not expose Orders", sourceId: null, checkedAt },
    { id: "shop_prices", state: "unavailable", reason: "No verified shop/base-price provider is configured", sourceId: null, checkedAt },
    { id: "fees", state: "unknown", reason: "No effective-dated fee evidence is configured", sourceId: null, checkedAt },
    { id: "buyer_data", state: "unavailable", reason: "The documented transactions API has no buyer field", sourceId: null, checkedAt },
    { id: "client_observation", state: "disabled", reason: "Passive client observation requires separate authorization and validation", sourceId: null, checkedAt },
    { id: "automated_actions", state: "disabled", reason: "Automatic market actions are outside the initial product", sourceId: null, checkedAt },
  ];
}

function offsetFromCursor(cursor: string | null): number {
  if (cursor === null) return 0;
  if (!/^[0-9]+$/.test(cursor)) {
    throw new RepositoryError("INVALID_CURSOR", "Cursor is malformed");
  }
  const offset = Number(cursor);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new RepositoryError("INVALID_CURSOR", "Cursor is outside the supported range");
  }
  return offset;
}

function page<T>(values: T[], input: PageInput): CursorPage<T> {
  const offset = offsetFromCursor(input.cursor);
  const items = values.slice(offset, offset + input.limit);
  const nextOffset = offset + items.length;
  return {
    items: clone(items),
    nextCursor: nextOffset < values.length ? String(nextOffset) : null,
    total: values.length,
  };
}

export class InMemoryMarketRepository implements MarketRepository {
  private readonly usersByName = new Map<string, StoredUser>();
  private readonly usersById = new Map<string, User>();
  private readonly sessions = new Map<string, StoredSession>();
  private readonly modTokens = new Map<string, StoredModToken>();
  private readonly items: ItemDetail[];
  private readonly listings: ListingRecord[];
  private readonly sales: SaleRecord[];
  private readonly history: Record<string, HistoryPoint[]>;
  private readonly sources: SourceHealth[];
  private readonly features: FeatureAvailability[];
  private readonly watchlists = new Map<string, Watchlist>();
  private readonly alerts = new Map<string, AlertRule>();
  private readonly dashboards = new Map<string, Dashboard>();
  private readonly listeners = new Set<(event: OutboxEvent) => void>();
  private readonly outbox: OutboxEvent[];
  private readonly overview: MarketOverview;
  private readonly collectionHealth: CollectionHealth;
  private ready: boolean;

  constructor(seed: MemoryRepositorySeed = {}) {
    for (const stored of seed.users ?? []) {
      this.usersByName.set(stored.user.username.toLowerCase(), clone(stored));
      this.usersById.set(stored.user.id, clone(stored.user));
    }
    this.overview = clone(seed.overview ?? defaultOverview());
    this.items = clone(seed.items ?? []);
    this.listings = clone(seed.listings ?? []);
    this.sales = clone(seed.sales ?? []);
    this.history = clone(seed.history ?? {});
    this.sources = clone(seed.sources ?? []);
    this.collectionHealth = clone(seed.collectionHealth ?? defaultCollectionHealth());
    this.features = clone(seed.features ?? defaultFeatures());
    this.outbox = clone(seed.outbox ?? []);
    this.ready = seed.ready ?? true;
  }

  async readiness(): Promise<ReadinessResult> {
    return {
      ready: this.ready,
      checks: {
        repository: this.ready ? "ready" : "not_ready",
        collector: this.sources.length === 0 ? "unknown" : "ready",
      },
    };
  }

  setReady(ready: boolean): void {
    this.ready = ready;
  }

  async findUserByUsername(username: string): Promise<StoredUser | null> {
    const value = this.usersByName.get(username.toLowerCase());
    return value === undefined ? null : clone(value);
  }

  async findUserById(userId: string): Promise<User | null> {
    const value = this.usersById.get(userId);
    return value === undefined ? null : clone(value);
  }

  async createSession(session: StoredSession): Promise<void> {
    this.sessions.set(session.id, clone(session));
  }

  async findSessionByTokenHash(tokenHash: string): Promise<StoredSession | null> {
    for (const session of this.sessions.values()) {
      if (session.tokenHash === tokenHash) return clone(session);
    }
    return null;
  }

  async revokeSession(sessionId: string, revokedAt: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session !== undefined) {
      session.revokedAt = revokedAt;
    }
  }

  sessionSnapshot(): StoredSession[] {
    return clone([...this.sessions.values()]);
  }

  async createModToken(input: CreateModTokenInput): Promise<void> {
    this.modTokens.set(input.id, { ...clone(input), revokedAt: null });
  }

  async findModTokenByHash(tokenHash: string): Promise<StoredModToken | null> {
    for (const token of this.modTokens.values()) {
      if (token.tokenHash === tokenHash) return clone(token);
    }
    return null;
  }

  async listModTokens(userId: string): Promise<StoredModToken[]> {
    return clone([...this.modTokens.values()].filter((token) => token.userId === userId));
  }

  async revokeModToken(userId: string, tokenId: string, revokedAt: string): Promise<boolean> {
    const token = this.modTokens.get(tokenId);
    if (token === undefined || token.userId !== userId) return false;
    token.revokedAt = revokedAt;
    return true;
  }

  async getMarketOverview(): Promise<MarketOverview> {
    return clone(this.overview);
  }

  async searchItems(input: ItemSearchInput): Promise<CursorPage<ItemSummary>> {
    const query = input.query.trim().toLowerCase();
    const matches = this.items.filter((item) =>
      query.length === 0 ||
      item.id.toLowerCase().includes(query) ||
      item.baseItemId.toLowerCase().includes(query) ||
      item.displayName.toLowerCase().includes(query) ||
      (item.variantLabel?.toLowerCase().includes(query) ?? false),
    );
    return page<ItemSummary>(matches, input);
  }

  async getItem(itemId: string): Promise<ItemDetail | null> {
    const item = this.items.find((candidate) => candidate.id === itemId);
    return item === undefined ? null : clone(item);
  }

  async listListings(itemId: string, input: PageInput): Promise<CursorPage<ListingRecord>> {
    return page(this.listings.filter((listing) => listing.itemId === itemId), input);
  }

  async listSales(itemId: string, input: PageInput): Promise<CursorPage<SaleRecord>> {
    return page(this.sales.filter((sale) => sale.itemId === itemId), input);
  }

  async getHistory(itemId: string, input: HistoryInput): Promise<HistoryPoint[]> {
    const from = Date.parse(input.from);
    const to = Date.parse(input.to);
    return clone((this.history[itemId] ?? []).filter((point) => {
      const start = Date.parse(point.start);
      return point.interval === input.interval && start >= from && start <= to;
    }));
  }

  async listSources(): Promise<SourceHealth[]> {
    return clone(this.sources);
  }

  async getCollectionHealth(): Promise<CollectionHealth> {
    return clone(this.collectionHealth);
  }

  async listFeatures(): Promise<FeatureAvailability[]> {
    return clone(this.features);
  }

  async listWatchlists(userId: string): Promise<Watchlist[]> {
    return clone([...this.watchlists.values()].filter((watchlist) => watchlist.userId === userId));
  }

  async createWatchlist(userId: string, input: CreateWatchlistInput): Promise<Watchlist> {
    const timestamp = nowIso();
    const value: Watchlist = {
      id: randomUUID(),
      userId,
      name: input.name,
      itemIds: [...input.itemIds],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.watchlists.set(value.id, value);
    return clone(value);
  }

  async updateWatchlist(userId: string, id: string, input: CreateWatchlistInput): Promise<Watchlist | null> {
    const value = this.watchlists.get(id);
    if (value === undefined || value.userId !== userId) return null;
    value.name = input.name;
    value.itemIds = [...input.itemIds];
    value.updatedAt = nowIso();
    return clone(value);
  }

  async deleteWatchlist(userId: string, id: string): Promise<boolean> {
    const value = this.watchlists.get(id);
    if (value === undefined || value.userId !== userId) return false;
    return this.watchlists.delete(id);
  }

  async listAlerts(userId: string): Promise<AlertRule[]> {
    return clone([...this.alerts.values()].filter((alert) => alert.userId === userId));
  }

  async createAlert(userId: string, input: CreateAlertInput): Promise<AlertRule> {
    const timestamp = nowIso();
    const value: AlertRule = {
      id: randomUUID(),
      userId,
      ...clone(input),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.alerts.set(value.id, value);
    return clone(value);
  }

  async updateAlert(userId: string, id: string, input: CreateAlertInput): Promise<AlertRule | null> {
    const current = this.alerts.get(id);
    if (current === undefined || current.userId !== userId) return null;
    const updated: AlertRule = {
      id,
      userId,
      ...clone(input),
      createdAt: current.createdAt,
      updatedAt: nowIso(),
    };
    this.alerts.set(id, updated);
    return clone(updated);
  }

  async deleteAlert(userId: string, id: string): Promise<boolean> {
    const value = this.alerts.get(id);
    if (value === undefined || value.userId !== userId) return false;
    return this.alerts.delete(id);
  }

  async listDashboards(userId: string): Promise<Dashboard[]> {
    return clone([...this.dashboards.values()].filter((dashboard) => dashboard.userId === userId));
  }

  async createDashboard(userId: string, input: CreateDashboardInput): Promise<Dashboard> {
    const timestamp = nowIso();
    const value: Dashboard = {
      id: randomUUID(),
      userId,
      ...clone(input),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.dashboards.set(value.id, value);
    return clone(value);
  }

  async updateDashboard(userId: string, id: string, input: CreateDashboardInput): Promise<Dashboard | null> {
    const current = this.dashboards.get(id);
    if (current === undefined || current.userId !== userId) return null;
    const updated: Dashboard = {
      id,
      userId,
      ...clone(input),
      createdAt: current.createdAt,
      updatedAt: nowIso(),
    };
    this.dashboards.set(id, updated);
    return clone(updated);
  }

  async deleteDashboard(userId: string, id: string): Promise<boolean> {
    const value = this.dashboards.get(id);
    if (value === undefined || value.userId !== userId) return false;
    return this.dashboards.delete(id);
  }

  async exportUserData(userId: string): Promise<ExportBundle> {
    return {
      generatedAt: nowIso(),
      items: clone(this.items),
      listings: clone(this.listings),
      sales: clone(this.sales),
      watchlists: await this.listWatchlists(userId),
      alerts: await this.listAlerts(userId),
      dashboards: await this.listDashboards(userId),
    };
  }

  async readOutbox(
    afterCursor: string | null,
    limit: number,
    audiences: readonly OutboxEvent["audience"][],
  ): Promise<OutboxEvent[]> {
    const after = offsetFromCursor(afterCursor);
    return clone(this.outbox.filter((event) =>
      Number(event.cursor) > after && audiences.includes(event.audience),
    ).slice(0, limit));
  }

  subscribeOutbox(
    listener: (event: OutboxEvent) => void,
    audiences: readonly OutboxEvent["audience"][],
  ): () => void {
    const filtered = (event: OutboxEvent) => {
      if (audiences.includes(event.audience)) listener(event);
    };
    this.listeners.add(filtered);
    return () => this.listeners.delete(filtered);
  }

  appendOutbox(
    type: OutboxEvent["type"],
    payload: Record<string, unknown>,
    audience: OutboxEvent["audience"] = "authenticated",
  ): OutboxEvent {
    const event: OutboxEvent = {
      cursor: String(this.outbox.length + 1),
      audience,
      type,
      occurredAt: nowIso(),
      payload: clone(payload),
    };
    this.outbox.push(event);
    for (const listener of this.listeners) listener(clone(event));
    return clone(event);
  }
}
