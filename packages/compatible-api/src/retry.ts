import { asCompatibleApiError, CompatibleApiError } from "./errors.js";

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly maxRetryAfterMs?: number;
  readonly random?: () => number;
  readonly sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export interface RetryEvent {
  readonly failedAttempt: number;
  readonly nextAttempt: number;
  readonly delayMs: number;
  readonly error: CompatibleApiError;
}

export interface RetryOptions {
  readonly signal?: AbortSignal;
  readonly secrets?: readonly string[];
  readonly onRetry?: (event: RetryEvent) => void | Promise<void>;
}

function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
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

export function parseRetryAfter(value: string | undefined, nowUnixMs = Date.now()): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const milliseconds = Number(trimmed) * 1_000;
    return Number.isFinite(milliseconds) ? Math.max(0, Math.ceil(milliseconds)) : undefined;
  }
  const timestamp = Date.parse(trimmed);
  return Number.isNaN(timestamp) ? undefined : Math.max(0, timestamp - nowUnixMs);
}

export function computeRetryDelay(
  failedAttempt: number,
  policy: RetryPolicy,
  retryAfterMs?: number,
): number {
  if (!Number.isSafeInteger(failedAttempt) || failedAttempt < 1) throw new RangeError("failedAttempt must be positive");
  const exponent = Math.min(30, failedAttempt - 1);
  const exponentialCap = Math.min(policy.maxDelayMs, policy.baseDelayMs * (2 ** exponent));
  const random = policy.random ?? Math.random;
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample > 1) throw new RangeError("Retry random source must return 0 through 1");
  const jitter = Math.floor(exponentialCap * sample);
  const boundedRetryAfter = retryAfterMs === undefined
    ? 0
    : Math.min(retryAfterMs, policy.maxRetryAfterMs ?? 15 * 60_000);
  return Math.max(jitter, boundedRetryAfter);
}

function validatePolicy(policy: RetryPolicy): void {
  if (!Number.isSafeInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
    throw new RangeError("maxAttempts must be a positive integer");
  }
  if (!Number.isFinite(policy.baseDelayMs) || policy.baseDelayMs < 0) {
    throw new RangeError("baseDelayMs must be non-negative");
  }
  if (!Number.isFinite(policy.maxDelayMs) || policy.maxDelayMs < policy.baseDelayMs) {
    throw new RangeError("maxDelayMs must be at least baseDelayMs");
  }
}

export async function executeWithRetry<T>(
  operation: (attempt: number) => Promise<T>,
  policy: RetryPolicy,
  options: RetryOptions = {},
): Promise<{ readonly value: T; readonly attempts: number }> {
  validatePolicy(policy);
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    if (options.signal?.aborted) {
      throw new CompatibleApiError({ code: "aborted", message: "Request aborted", retryable: false });
    }
    try {
      return Object.freeze({ value: await operation(attempt), attempts: attempt });
    } catch (caught) {
      const error = asCompatibleApiError(caught, options.secrets);
      if (!error.retryable || attempt === policy.maxAttempts) throw error;
      const delayMs = computeRetryDelay(attempt, policy, error.retryAfterMs);
      await options.onRetry?.(Object.freeze({
        failedAttempt: attempt,
        nextAttempt: attempt + 1,
        delayMs,
        error,
      }));
      try {
        await (policy.sleep ?? sleep)(delayMs, options.signal);
      } catch (sleepError) {
        throw new CompatibleApiError({ code: "aborted", message: "Retry wait aborted", retryable: false, cause: sleepError });
      }
    }
  }
  throw new CompatibleApiError({ code: "unknown", message: "Retry loop exited unexpectedly", retryable: false });
}
