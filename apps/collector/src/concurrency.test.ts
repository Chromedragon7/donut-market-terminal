import { describe, expect, it, vi } from "vitest";
import { mapWithConcurrency } from "./concurrency.js";

describe("mapWithConcurrency", () => {
  it("preserves result order while bounding in-flight operations", async () => {
    let inFlight = 0;
    let maximum = 0;
    const result = await mapWithConcurrency([3, 1, 2, 0], 2, async (value) => {
      inFlight += 1;
      maximum = Math.max(maximum, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return value * 2;
    });

    expect(result).toEqual([6, 2, 4, 0]);
    expect(maximum).toBe(2);
  });

  it("drains claimed work and stops assigning new work after a failure", async () => {
    const operation = vi.fn(async (value: number) => {
      await Promise.resolve();
      if (value === 2) throw new Error("write failed");
      return value;
    });

    await expect(mapWithConcurrency([1, 2, 3, 4, 5], 2, operation)).rejects.toThrow("write failed");
    expect(operation.mock.calls.length).toBeLessThan(5);
  });
});
