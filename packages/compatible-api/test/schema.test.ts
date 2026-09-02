import {
  compareRationals,
  decimalToRational,
  multiplyRational,
} from "@donut/domain";
import { describe, expect, it } from "vitest";
import { parseLosslessJson } from "../src/lossless-json.js";
import { parseListingEnvelope, parseTransactionEnvelope } from "../src/schema.js";

const item = '{"id":"minecraft:diamond","count":64,"display_name":"Diamond","lore":[],"enchants":{"enchantments":{"levels":{}},"trim":{"material":null,"pattern":null}},"contents":[]}';
const seller = '{"name":"ExampleSeller","uuid":"01234567-89ab-cdef-0123-456789abcdef"}';
const listingBody = '{"status":200,"result":[{"item":' + item + ',"price":900719925474099312345.125,"seller":' + seller + ',"time_left":59999},null,null]}';
const transaction = '{"item":' + item + ',"price":128.50,"seller":' + seller + ',"unixMillisDateSold":1893456000123}';

describe("compatible response schemas", () => {
  it("preserves exact money and null-padded listing positions", () => {
    const page = parseListingEnvelope(parseLosslessJson(listingBody), {
      sourceId: "fixture",
      page: 7,
      observedAtUnixMs: 1_893_456_000_000n,
    });

    expect(page.httpBodyStatus).toBe(200);
    expect(page.resultPositionCount).toBe(3);
    expect(page.nullPaddingCount).toBe(2);
    expect(page.nullPaddingPositions).toEqual([1, 2]);
    expect(page.records).toHaveLength(1);
    const listing = page.records[0]!.value!;
    expect(listing.totalPriceLexeme).toBe("900719925474099312345.125");
    expect(listing.stackPricing.totalCanonical).toBe("900719925474099312345.125");
    expect(listing.stackPricing.quantity).toBe(64n);
    expect(compareRationals(
      multiplyRational(listing.stackPricing.unit, 64n),
      decimalToRational(listing.stackPricing.total),
    )).toBe(0);
    expect(listing.probabilisticFingerprint.stableIdentity).toBe(false);
    expect(listing.normalizedVariant.completeness.classification).toBe("strong_match");
  });

  it("assigns occurrence ordinals without discarding identical transactions", () => {
    const body = '{"status":200,"result":[' + transaction + "," + transaction + "]}";
    const page = parseTransactionEnvelope(parseLosslessJson(body), {
      sourceId: "fixture",
      page: 1,
      observedAtUnixMs: 1_893_456_000_000n,
    });
    expect(page.records).toHaveLength(2);
    const first = page.records[0]!.value!;
    const second = page.records[1]!.value!;
    expect(first.fingerprint.value).toBe(second.fingerprint.value);
    expect(first.occurrenceOrdinal).toBe(1);
    expect(second.occurrenceOrdinal).toBe(2);
    expect(first.identicalOccurrenceCount).toBe(2);
    expect(first.collisionAmbiguous).toBe(true);
    expect(first.occurrenceKey).not.toBe(second.occurrenceKey);
  });

  it("makes null enchant levels explicit instead of inventing metadata", () => {
    const enchanted = '{"id":"minecraft:enchanted_book","count":1,"display_name":"Book","lore":[],"enchants":{"enchantments":{"levels":null},"trim":null},"contents":[]}';
    const body = '{"status":200,"result":[{"item":' + enchanted + ',"price":1234,"seller":' + seller + ',"unixMillisDateSold":1893456000123}]}';
    const page = parseTransactionEnvelope(parseLosslessJson(body), {
      sourceId: "fixture",
      page: 1,
      observedAtUnixMs: 1_893_456_000_000n,
    });
    expect(page.records[0]!.state).toBe("partial");
    expect(page.records[0]!.issues.map((issue) => issue.code)).toContain("enchantment_levels_unavailable");
    expect(page.records[0]!.value!.normalizedVariant.completeness.classification).toBe("ambiguous");
  });

  it("preserves unknown fields while reporting them", () => {
    const body = '{"status":200,"result":[{' +
      '"item":' + item + ',"price":1,"seller":' + seller +
      ',"unixMillisDateSold":1893456000123,"future_field":{"x":1}}]}';
    const page = parseTransactionEnvelope(parseLosslessJson(body), {
      sourceId: "fixture",
      page: 1,
      observedAtUnixMs: 1_893_456_000_000n,
    });
    expect(page.records[0]!.issues.map((issue) => issue.code)).toContain("unknown_field");
    expect((page.records[0]!.raw as Record<string, unknown>).future_field).toBeDefined();
  });
});
