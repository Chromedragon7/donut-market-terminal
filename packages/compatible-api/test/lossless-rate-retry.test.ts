import { describe, expect, it, vi } from "vitest";
import { isLosslessJsonNumber, parseLosslessJson } from "../src/lossless-json.js";
import { TokenBucketRateBudget } from "../src/rate-budget.js";
import { computeRetryDelay, executeWithRetry, parseRetryAfter } from "../src/retry.js";
import { CompatibleApiError } from "../src/errors.js";

describe("lossless JSON", () => {
  it("keeps every numeric token as its original decimal lexeme", () => {
    const parsed = parseLosslessJson('{"large":900719925474099312345.125,"scientific":1.20e+3}') as Record<string, unknown>;
    expect(isLosslessJsonNumber(parsed.large) && parsed.large.lexeme).toBe("900719925474099312345.125");
    expect(isLosslessJsonNumber(parsed.scientific) && parsed.scientific.lexeme).toBe("1.20e+3");
  });

  it("rejects duplicate keys and trailing data", () => {
    expect(() => parseLosslessJson('{"x":1,"x":2}')).toThrow(/Duplicate object key/);
    expect(() => parseLosslessJson("{} null")).toThrow(/trailing data/);
  });
});

describe("rate budget", () => {
  it("keeps reserve capacity unavailable to listing scans", () => {
    const budget = new TokenBucketRateBudget({
      requestsPerMinute: 10,
      burstCapacity: 10,
      reservedTransactionCapacity: 2,
      initialTokens: "full",
      now: () => 0,
    });
    for (let index = 0; index < 8; index += 1) {
      expect(budget.tryAcquire("broad_market").granted).toBe(true);
    }
    const broad = budget.tryAcquire("broad_market");
    expect(broad.granted).toBe(false);
    expect(budget.tryAcquire("transactions").granted).toBe(true);
    expect(budget.tryAcquire("transactions").granted).toBe(true);
    expect(budget.tryAcquire("transactions").granted).toBe(false);
  });

  it("spends the transaction reserve before shared capacity", () => {
    const budget = new TokenBucketRateBudget({
      requestsPerMinute: 10,
      burstCapacity: 10,
      reservedTransactionCapacity: 2,
      initialTokens: "full",
      now: () => 0,
    });
    expect(budget.tryAcquire("transactions", 2).granted).toBe(true);
    for (let index = 0; index < 8; index += 1) {
      expect(budget.tryAcquire("broad_market").granted).toBe(true);
    }
  });

  it("refills deterministically", () => {
    let now = 0;
    const budget = new TokenBucketRateBudget({
      requestsPerMinute: 60,
      burstCapacity: 60,
      reservedTransactionCapacity: 0,
      initialTokens: "empty",
      now: () => now,
    });
    expect(budget.tryAcquire("watched_listings").granted).toBe(false);
    now = 1_000;
    expect(budget.tryAcquire("watched_listings").granted).toBe(true);
  });
});

describe("retry policy", () => {
  it("honors Retry-After and bounded full jitter", () => {
    expect(parseRetryAfter("1.5", 0)).toBe(1_500);
    expect(parseRetryAfter("Thu, 01 Jan 1970 00:00:03 GMT", 1_000)).toBe(2_000);
    expect(computeRetryDelay(2, {
      maxAttempts: 4,
      baseDelayMs: 100,
      maxDelayMs: 1_000,
      random: () => 0.5,
    })).toBe(100);
    expect(computeRetryDelay(1, {
      maxAttempts: 4,
      baseDelayMs: 100,
      maxDelayMs: 1_000,
      random: () => 0,
    }, 750)).toBe(750);
  });

  it("retries only retryable failures", async () => {
    const sleep = vi.fn(async () => undefined);
    let calls = 0;
    const result = await executeWithRetry(async () => {
      calls += 1;
      if (calls === 1) throw new CompatibleApiError({
        code: "rate_limited",
        message: "wait",
        retryable: true,
        retryAfterMs: 20,
      });
      return "ok";
    }, {
      maxAttempts: 3,
      baseDelayMs: 10,
      maxDelayMs: 100,
      random: () => 0,
      sleep,
    });
    expect(result).toEqual({ value: "ok", attempts: 2 });
    expect(sleep).toHaveBeenCalledWith(20, undefined);
  });
});
