import { CompatibleApiError } from "./errors.js";

export type RequestClass =
  | "transactions"
  | "watched_listings"
  | "broad_market"
  | "metadata"
  | "backfill";

export interface RateBudgetConfig {
  readonly requestsPerMinute: number;
  readonly burstCapacity?: number;
  readonly reservedTransactionCapacity: number;
  readonly initialTokens?: "empty" | "full";
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export interface RateBudgetSnapshot {
  readonly requestsPerMinute: number;
  readonly burstCapacity: number;
  readonly reservedTransactionCapacity: number;
  readonly generalTokens: number;
  readonly transactionReservedTokens: number;
  readonly observedAtUnixMs: number;
}

export type PermitResult =
  | { readonly granted: true; readonly requestClass: RequestClass; readonly cost: number }
  | { readonly granted: false; readonly requestClass: RequestClass; readonly cost: number; readonly retryAfterMs: number };

function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

/**
 * In-memory token bucket with capacity that only transaction requests may use.
 * A distributed deployment must put one instance behind the key-scoped leader
 * or replace it with a shared atomic implementation.
 */
export class TokenBucketRateBudget {
  private readonly requestsPerMinute: number;
  private readonly burstCapacity: number;
  private readonly reservedCapacity: number;
  private readonly generalCapacity: number;
  private readonly generalRefillPerMs: number;
  private readonly reservedRefillPerMs: number;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  private generalTokens: number;
  private reservedTokens: number;
  private lastRefillMs: number;

  constructor(config: RateBudgetConfig) {
    const burstCapacity = config.burstCapacity ?? config.requestsPerMinute;
    for (const [name, value] of Object.entries({
      requestsPerMinute: config.requestsPerMinute,
      burstCapacity,
      reservedTransactionCapacity: config.reservedTransactionCapacity,
    })) {
      if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative safe integer`);
    }
    if (config.requestsPerMinute <= 0 || burstCapacity <= 0) throw new RangeError("Rate capacity must be positive");
    if (config.reservedTransactionCapacity > burstCapacity) {
      throw new RangeError("reservedTransactionCapacity cannot exceed burstCapacity");
    }

    this.requestsPerMinute = config.requestsPerMinute;
    this.burstCapacity = burstCapacity;
    this.reservedCapacity = config.reservedTransactionCapacity;
    this.generalCapacity = burstCapacity - this.reservedCapacity;
    this.generalRefillPerMs = (config.requestsPerMinute * (this.generalCapacity / burstCapacity)) / 60_000;
    this.reservedRefillPerMs = (config.requestsPerMinute * (this.reservedCapacity / burstCapacity)) / 60_000;
    this.now = config.now ?? Date.now;
    this.sleep = config.sleep ?? defaultSleep;
    this.lastRefillMs = this.now();
    const full = (config.initialTokens ?? "full") === "full";
    this.generalTokens = full ? this.generalCapacity : 0;
    this.reservedTokens = full ? this.reservedCapacity : 0;
  }

  private refill(): number {
    const current = this.now();
    const elapsed = Math.max(0, current - this.lastRefillMs);
    this.lastRefillMs = Math.max(this.lastRefillMs, current);
    this.generalTokens = Math.min(this.generalCapacity, this.generalTokens + elapsed * this.generalRefillPerMs);
    this.reservedTokens = Math.min(this.reservedCapacity, this.reservedTokens + elapsed * this.reservedRefillPerMs);
    return current;
  }

  private availableAt(requestClass: RequestClass, milliseconds: number): number {
    const general = Math.min(this.generalCapacity, this.generalTokens + milliseconds * this.generalRefillPerMs);
    if (requestClass !== "transactions") return general;
    const reserved = Math.min(this.reservedCapacity, this.reservedTokens + milliseconds * this.reservedRefillPerMs);
    return general + reserved;
  }

  private waitFor(requestClass: RequestClass, cost: number): number {
    if (this.availableAt(requestClass, 0) >= cost) return 0;
    let upper = 1;
    while (upper < 3_600_000 && this.availableAt(requestClass, upper) < cost) upper *= 2;
    if (this.availableAt(requestClass, upper) < cost) return 3_600_000;
    let lower = 0;
    while (lower + 1 < upper) {
      const middle = Math.floor((lower + upper) / 2);
      if (this.availableAt(requestClass, middle) >= cost) upper = middle;
      else lower = middle;
    }
    return Math.max(1, upper);
  }

  tryAcquire(requestClass: RequestClass, cost = 1): PermitResult {
    if (!Number.isSafeInteger(cost) || cost <= 0 || cost > this.burstCapacity) {
      throw new RangeError("Permit cost must be a positive integer no greater than burstCapacity");
    }
    this.refill();
    const available = requestClass === "transactions"
      ? this.generalTokens + this.reservedTokens
      : this.generalTokens;
    if (available + Number.EPSILON < cost) {
      return Object.freeze({
        granted: false,
        requestClass,
        cost,
        retryAfterMs: this.waitFor(requestClass, cost),
      });
    }

    if (requestClass === "transactions") {
      const fromReserve = Math.min(this.reservedTokens, cost);
      this.reservedTokens -= fromReserve;
      this.generalTokens -= cost - fromReserve;
    } else {
      this.generalTokens -= cost;
    }
    return Object.freeze({ granted: true, requestClass, cost });
  }

  async acquire(requestClass: RequestClass, options: { readonly cost?: number; readonly signal?: AbortSignal } = {}): Promise<void> {
    const cost = options.cost ?? 1;
    while (true) {
      if (options.signal?.aborted) {
        throw new CompatibleApiError({ code: "aborted", message: "Rate-budget wait aborted", retryable: false });
      }
      const permit = this.tryAcquire(requestClass, cost);
      if (permit.granted) return;
      try {
        await this.sleep(permit.retryAfterMs, options.signal);
      } catch (error) {
        throw new CompatibleApiError({ code: "aborted", message: "Rate-budget wait aborted", retryable: false, cause: error });
      }
    }
  }

  snapshot(): RateBudgetSnapshot {
    const observedAtUnixMs = this.refill();
    return Object.freeze({
      requestsPerMinute: this.requestsPerMinute,
      burstCapacity: this.burstCapacity,
      reservedTransactionCapacity: this.reservedCapacity,
      generalTokens: this.generalTokens,
      transactionReservedTokens: this.reservedTokens,
      observedAtUnixMs,
    });
  }
}
