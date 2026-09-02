import { describe, expect, it } from "vitest";
import {
  assessConfidence,
  classifyFreshness,
  createRawObservationEvidence,
  detectHistoricalGaps,
  rationalToString,
  summarizeMarketTrades,
} from "../src/index.js";

describe("market evidence helpers", () => {
  it("calculates exact trade statistics without mixing stack and unit prices", () => {
    const result = summarizeMarketTrades([
      { totalPrice: "12", quantity: 3, soldAtUnixMs: 1 },
      { totalPrice: "10", quantity: 2, soldAtUnixMs: 2 },
    ]);
    expect(result.recordedQuantity).toBe(5n);
    expect(rationalToString(result.recordedTurnover)).toBe("22");
    expect(rationalToString(result.openUnitPrice!)).toBe("4");
    expect(rationalToString(result.closeUnitPrice!)).toBe("5");
    expect(rationalToString(result.meanUnitPrice!)).toBe("4.5");
    expect(rationalToString(result.quantityWeightedMeanUnitPrice!)).toBe("4.4");
  });

  it("classifies freshness and detects expected-cadence gaps", () => {
    expect(classifyFreshness(900n, 1_000n, {
      freshForMs: 100,
      staleAfterMs: 200,
      expireAfterMs: 500,
    }).state).toBe("fresh");
    const gaps = detectHistoricalGaps([0n, 100n, 450n], { expectedIntervalMs: 100n, allowedLatenessMs: 25n });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.estimatedMissingIntervals).toBe(3n);
  });

  it("makes confidence deductions explicit", () => {
    const confidence = assessConfidence({
      sampleSize: 2,
      completeness: "ambiguous",
      freshness: "stale",
      gapCount: 1,
      sourceHealthy: false,
    });
    expect(confidence.label).toBe("low");
    expect(confidence.reasons).toContain("sample_size_below_3");
    expect(confidence.reasons).toContain("historical_gaps_present");
  });

  it("retains exact raw text and removes sensitive headers", () => {
    const evidence = createRawObservationEvidence({
      sourceId: "mirror",
      providerVersion: "1",
      collectorVersion: "test",
      endpoint: "/v1/auction/transactions/1",
      observedAt: "2026-09-01T00:00:00Z",
      httpStatus: 200,
      contentType: "text/plain",
      responseHeaders: { authorization: "Bearer should-not-survive", etag: "abc" },
      rawBody: '{"price":9007199254740993}',
      validationState: "valid",
      normalizationState: "normalized",
      confidence: "medium",
    });
    expect(evidence.byteLength).toBe(Buffer.byteLength(evidence.rawBody));
    expect(evidence.responseHeaders).toEqual({ etag: "abc" });
    expect(evidence.contentSha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
