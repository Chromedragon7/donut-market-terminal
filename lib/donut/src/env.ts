function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === "" ? fallback : raw;
}

export const config = {
  upstreamBaseUrl: str("DONUT_API_BASE_URL", "https://api.donutsmp.net"),
  requestTimeoutMs: num("DONUT_REQUEST_TIMEOUT_MS", 15000),
  softRateLimitPerMin: num("DONUT_RATE_LIMIT_PER_MIN", 200),
  maxConcurrency: num("DONUT_MAX_CONCURRENCY", 3),
  maxRetries: num("DONUT_MAX_RETRIES", 4),
  auctionMaxPages: num("DONUT_AUCTION_MAX_PAGES", 200),
  leaderboardMaxPages: num("DONUT_LEADERBOARD_MAX_PAGES", 20),
  playerCacheMinutes: num("DONUT_PLAYER_CACHE_MINUTES", 15),
  rawListingRetentionDays: num("DONUT_RAW_LISTING_RETENTION_DAYS", 3),
  orderDataSource: str("ORDER_DATA_SOURCE", "none"),
} as const;

export function hasApiKey(): boolean {
  const key = process.env.DONUTSMP_API_KEY;
  return typeof key === "string" && key.trim().length > 0;
}

export function getApiKey(): string {
  const key = process.env.DONUTSMP_API_KEY;
  if (!key || key.trim().length === 0) {
    throw new Error("DONUTSMP_API_KEY is not configured");
  }
  return key;
}
