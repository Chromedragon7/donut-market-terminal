import { z } from "zod";
import { config, getApiKey } from "./env";
import { UpstreamError, isRetryable } from "./errors";
import {
  AhResponseSchema,
  LeaderboardResponseSchema,
  LookupResponseSchema,
  StatsResponseSchema,
  TransactionHistoryResponseSchema,
} from "./upstream-types";
import type { LeaderboardCategory } from "./leaderboard";

interface QueueItem {
  run: () => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Shared token-bucket + concurrency-limited scheduler. A single instance is
 * exported so every caller in a process shares the same upstream budget.
 */
class RateLimiter {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private lastRefill = Date.now();
  private active = 0;
  private readonly queue: QueueItem[] = [];

  constructor(perMinute: number, private readonly concurrency: number) {
    this.capacity = perMinute;
    this.tokens = perMinute;
    this.refillPerMs = perMinute / 60000;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;
    this.tokens = Math.min(
      this.capacity,
      this.tokens + elapsed * this.refillPerMs,
    );
    this.lastRefill = now;
  }

  async acquire(): Promise<void> {
    await new Promise<void>((resolve) => {
      const attempt = () => {
        this.refill();
        if (this.active < this.concurrency && this.tokens >= 1) {
          this.tokens -= 1;
          this.active += 1;
          resolve();
        } else {
          this.queue.push({ run: attempt });
          const waitMs =
            this.tokens >= 1 ? 25 : Math.ceil(1 / this.refillPerMs);
          setTimeout(() => {
            const idx = this.queue.findIndex((q) => q.run === attempt);
            if (idx !== -1) this.queue.splice(idx, 1);
            attempt();
          }, Math.min(waitMs, 1000));
        }
      };
      attempt();
    });
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.queue.shift();
    if (next) next.run();
  }
}

const limiter = new RateLimiter(config.softRateLimitPerMin, config.maxConcurrency);

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const asInt = Number(header);
  if (Number.isFinite(asInt)) return asInt * 1000;
  const asDate = Date.parse(header);
  if (Number.isFinite(asDate)) return Math.max(0, asDate - Date.now());
  return null;
}

function classify(status: number, retryAfterMs?: number): UpstreamError {
  if (status === 401 || status === 403)
    return new UpstreamError("unauthorized", "Upstream rejected credentials", {
      statusCode: status,
    });
  if (status === 404)
    return new UpstreamError("not_found", "Upstream resource not found", {
      statusCode: status,
    });
  if (status === 429)
    return new UpstreamError("rate_limited", "Upstream rate limited", {
      statusCode: status,
      // Fall back to 65 s (one full window + buffer) when no Retry-After header
      retryAfterMs: retryAfterMs ?? 65_000,
    });
  if (status >= 500)
    return new UpstreamError("transient_server_error", "Upstream server error", {
      statusCode: status,
    });
  return new UpstreamError("upstream_invalid", `Unexpected status ${status}`, {
    statusCode: status,
  });
}

interface RequestStats {
  upstreamRequests: number;
}

export interface DonutClient {
  stats: RequestStats;
  auctionList(page: number): Promise<z.infer<typeof AhResponseSchema>>;
  auctionTransactions(
    page: number,
  ): Promise<z.infer<typeof TransactionHistoryResponseSchema>>;
  leaderboard(
    category: LeaderboardCategory,
    page: number,
  ): Promise<z.infer<typeof LeaderboardResponseSchema>>;
  lookup(user: string): Promise<z.infer<typeof LookupResponseSchema>>;
  playerStats(user: string): Promise<z.infer<typeof StatsResponseSchema>>;
}

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  stats: RequestStats,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    await limiter.acquire();
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      config.requestTimeoutMs,
    );
    try {
      stats.upstreamRequests += 1;
      const res = await fetch(`${config.upstreamBaseUrl}${path}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${getApiKey()}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
        throw classify(res.status, retryAfterMs ?? undefined);
      }
      const raw = await res.json();
      // Normalize non-object responses to the standard { result: [] } envelope
      const json =
        raw !== null && typeof raw === "object" && !Array.isArray(raw)
          ? raw
          : Array.isArray(raw)
            ? { result: raw }
            : { result: [] };
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        const sample = JSON.stringify(raw).slice(0, 300);
        throw new UpstreamError(
          "upstream_invalid",
          `Upstream response failed validation: ${sample}`,
        );
      }
      return parsed.data;
    } catch (err) {
      const normalized =
        err instanceof UpstreamError
          ? err
          : err instanceof Error && err.name === "AbortError"
            ? new UpstreamError("timeout", "Upstream request timed out")
            : new UpstreamError(
                "transient_server_error",
                "Network failure contacting upstream",
              );
      attempt += 1;
      if (!isRetryable(normalized) || attempt > config.maxRetries) {
        throw normalized;
      }
      const backoff =
        normalized.retryAfterMs ??
        Math.min(2 ** attempt * 250, 8000) + Math.random() * 250;
      await sleep(backoff);
    } finally {
      clearTimeout(timeout);
      limiter.release();
    }
  }
}

export function createDonutClient(): DonutClient {
  const stats: RequestStats = { upstreamRequests: 0 };
  return {
    stats,
    auctionList: (page) =>
      request(`/v1/auction/list/${page}`, AhResponseSchema, stats),
    auctionTransactions: (page) =>
      request(
        `/v1/auction/transactions/${page}`,
        TransactionHistoryResponseSchema,
        stats,
      ),
    leaderboard: (category, page) =>
      request(
        `/v1/leaderboards/${category}/${page}`,
        LeaderboardResponseSchema,
        stats,
      ),
    lookup: (user) =>
      request(
        `/v1/lookup/${encodeURIComponent(user)}`,
        LookupResponseSchema,
        stats,
      ),
    playerStats: (user) =>
      request(
        `/v1/stats/${encodeURIComponent(user)}`,
        StatsResponseSchema,
        stats,
      ),
  };
}
