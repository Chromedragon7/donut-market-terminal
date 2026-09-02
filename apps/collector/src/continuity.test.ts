import { describe, expect, it } from "vitest";
import { detectTransactionWindowGap } from "./continuity.js";

describe("detectTransactionWindowGap", () => {
  it("records a confirmed gap when consecutive full windows no longer overlap", () => {
    const gap = detectTransactionWindowGap(
      "1788236400000",
      new Date("2026-09-01T12:00:00.000Z"),
      1_788_240_000_000n,
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
      new Date("2026-09-01T13:00:00.000Z"),
    );

    expect(gap).toMatchObject({
      resource: "auction_transactions",
      reason: "transaction_window_no_overlap",
      confidence: "confirmed",
    });
    expect(gap?.gapEnd?.valueOf()).toBe(1_788_240_000_000);
  });

  it("does not claim a gap when the accessible windows still overlap", () => {
    expect(detectTransactionWindowGap(
      "1788240000000",
      new Date("2026-09-01T12:00:00.000Z"),
      1_788_236_400_000n,
      "source",
      "run",
      new Date("2026-09-01T13:00:00.000Z"),
    )).toBeUndefined();
  });
});
