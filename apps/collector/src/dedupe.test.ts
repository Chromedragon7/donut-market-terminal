import { describe, expect, it } from "vitest";
import { reconcileTransactionPageOccurrences } from "./dedupe.js";

describe("reconcileTransactionPageOccurrences", () => {
  it("maps a moving-page repeat to one logical ordinal and flags uncertainty", () => {
    const result = reconcileTransactionPageOccurrences([
      { record: "first", page: 1, fingerprint: "same", occurrenceOrdinal: 1, collisionAmbiguous: false },
      { record: "repeat", page: 2, fingerprint: "same", occurrenceOrdinal: 1, collisionAmbiguous: false },
    ]);

    expect(result.map((entry) => entry.occurrenceOrdinal)).toEqual([1, 1]);
    expect(result.every((entry) => entry.repeatedAcrossPages)).toBe(true);
    expect(result.every((entry) => entry.collisionAmbiguous)).toBe(true);
  });

  it("preserves multiplicity proven within a single page", () => {
    const result = reconcileTransactionPageOccurrences([
      { record: "first", page: 1, fingerprint: "same", occurrenceOrdinal: 1, collisionAmbiguous: true },
      { record: "second", page: 1, fingerprint: "same", occurrenceOrdinal: 2, collisionAmbiguous: true },
    ]);

    expect(result.map((entry) => entry.occurrenceOrdinal)).toEqual([1, 2]);
    expect(result.every((entry) => !entry.repeatedAcrossPages)).toBe(true);
  });
});
