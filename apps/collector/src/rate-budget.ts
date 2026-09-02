export type RequestPriority = "transaction" | "listing" | "other";

export interface RateBudgetOptions {
  readonly requestsPerMinute: number;
  readonly transactionReservePercent: number;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

/**
 * Exact rolling-window limiter. Listing/background work can never consume the
 * transaction-reserved portion of the upstream request budget.
 */
export class PriorityRateBudget {
  private readonly totalLimit: number;
  private readonly reservedLimit: number;
  private readonly sharedLimit: number;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  private readonly reservedTransactions: number[] = [];
  private readonly sharedRequests: number[] = [];
  private lock: Promise<void> = Promise.resolve();

  public constructor(options: RateBudgetOptions) {
    if (!Number.isSafeInteger(options.requestsPerMinute) || options.requestsPerMinute < 2) {
      throw new RangeError("requestsPerMinute must be a safe integer of at least 2");
    }
    if (
      !Number.isFinite(options.transactionReservePercent)
      || options.transactionReservePercent <= 0
      || options.transactionReservePercent >= 100
    ) {
      throw new RangeError("transactionReservePercent must be greater than 0 and less than 100");
    }
    this.totalLimit = options.requestsPerMinute;
    this.reservedLimit = Math.max(
      1,
      Math.min(
        this.totalLimit - 1,
        Math.floor(this.totalLimit * options.transactionReservePercent / 100),
      ),
    );
    this.sharedLimit = this.totalLimit - this.reservedLimit;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? abortableSleep;
  }

  public async acquire(priority: RequestPriority, signal?: AbortSignal): Promise<void> {
    while (true) {
      throwIfAborted(signal);
      const decision = await this.exclusive(() => this.tryAcquire(priority));
      if (decision.acquired) return;
      await this.sleep(decision.waitMs, signal);
    }
  }

  public snapshot(): Readonly<Record<string, number>> {
    this.prune(this.now());
    return Object.freeze({
      totalLimit: this.totalLimit,
      reservedLimit: this.reservedLimit,
      sharedLimit: this.sharedLimit,
      reservedUsed: this.reservedTransactions.length,
      sharedUsed: this.sharedRequests.length,
    });
  }

  private tryAcquire(priority: RequestPriority): { readonly acquired: true } | { readonly acquired: false; readonly waitMs: number } {
    const now = this.now();
    this.prune(now);

    if (priority === "transaction" && this.reservedTransactions.length < this.reservedLimit) {
      this.reservedTransactions.push(now);
      return { acquired: true };
    }
    if (this.sharedRequests.length < this.sharedLimit) {
      this.sharedRequests.push(now);
      return { acquired: true };
    }

    const candidates = priority === "transaction"
      ? [this.reservedTransactions[0], this.sharedRequests[0]]
      : [this.sharedRequests[0]];
    const earliest = candidates
      .filter((value): value is number => value !== undefined)
      .reduce((minimum, value) => Math.min(minimum, value), Number.POSITIVE_INFINITY);
    return { acquired: false, waitMs: Math.max(1, earliest + 60_000 - now) };
  }

  private prune(now: number): void {
    const cutoff = now - 60_000;
    while ((this.reservedTransactions[0] ?? Number.POSITIVE_INFINITY) <= cutoff) {
      this.reservedTransactions.shift();
    }
    while ((this.sharedRequests[0] ?? Number.POSITIVE_INFINITY) <= cutoff) {
      this.sharedRequests.shift();
    }
  }

  private async exclusive<T>(operation: () => T): Promise<T> {
    const previous = this.lock;
    let release: (() => void) | undefined;
    this.lock = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return operation();
    } finally {
      release?.();
    }
  }
}

export class RunBackoff {
  private failures = 0;

  public constructor(
    private readonly baseMs: number,
    private readonly maximumMs: number,
    private readonly random: () => number = Math.random,
  ) {
    if (baseMs <= 0 || maximumMs < baseMs) throw new RangeError("Invalid backoff bounds");
  }

  public nextDelay(): number {
    this.failures += 1;
    const exponential = Math.min(this.maximumMs, this.baseMs * 2 ** Math.min(this.failures - 1, 30));
    const jitter = 0.5 + this.random();
    return Math.max(1, Math.min(this.maximumMs, Math.floor(exponential * jitter)));
  }

  public reset(): void {
    this.failures = 0;
  }

  public get failureCount(): number {
    return this.failures;
  }
}

export async function abortableSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new RangeError("Invalid sleep duration");
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const finish = (): void => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    const abort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason instanceof Error ? signal.reason : new Error("Operation aborted"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal !== undefined) timer.unref?.();
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw signal.reason instanceof Error ? signal.reason : new Error("Operation aborted");
  }
}
