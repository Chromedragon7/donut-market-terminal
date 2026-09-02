import { describe, expect, it } from "vitest";
import { PriorityRateBudget, RunBackoff } from "./rate-budget.js";

describe("PriorityRateBudget", () => {
  it("reserves capacity for transaction continuity", async () => {
    let now = 1_000_000;
    const sleeps: number[] = [];
    const budget = new PriorityRateBudget({
      requestsPerMinute: 10,
      transactionReservePercent: 60,
      now: () => now,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        now += milliseconds;
      },
    });

    for (let index = 0; index < 4; index += 1) await budget.acquire("listing");
    for (let index = 0; index < 6; index += 1) await budget.acquire("transaction");
    expect(sleeps).toEqual([]);

    await budget.acquire("listing");
    expect(sleeps).toEqual([60_000]);
  });

  it("never allows a request count outside safe bounds", () => {
    expect(() => new PriorityRateBudget({
      requestsPerMinute: 0,
      transactionReservePercent: 60,
    })).toThrow("at least 2");
  });
});

describe("RunBackoff", () => {
  it("grows exponentially, caps, and resets", () => {
    const backoff = new RunBackoff(100, 250, () => 0.5);
    expect(backoff.nextDelay()).toBe(100);
    expect(backoff.nextDelay()).toBe(200);
    expect(backoff.nextDelay()).toBe(250);
    backoff.reset();
    expect(backoff.nextDelay()).toBe(100);
  });

  it("never lets positive jitter exceed the configured maximum", () => {
    const backoff = new RunBackoff(100, 250, () => 1);
    expect(backoff.nextDelay()).toBe(150);
    expect(backoff.nextDelay()).toBe(250);
    expect(backoff.nextDelay()).toBe(250);
  });
});
