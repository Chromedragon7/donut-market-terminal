import { describe, expect, it } from "vitest";
import {
  assignTransactionOccurrenceOrdinals,
  canonicalJson,
  createListingObservationFingerprint,
  createTransactionFingerprint,
  normalizeItemVariant,
  type SourceItemForNormalization,
} from "../src/index.js";

const states = {
  displayName: "present",
  lore: "present",
  enchantments: "present",
  trim: "present",
  contents: "present",
} as const;

function item(overrides: Partial<SourceItemForNormalization> = {}): SourceItemForNormalization {
  return {
    id: "minecraft:diamond_sword",
    count: 1n,
    displayName: "",
    lore: [],
    enchantments: { "minecraft:sharpness": 5n, "minecraft:mending": 1n },
    trim: null,
    contents: [],
    fieldStates: states,
    metadataCoverage: "partial",
    ...overrides,
  };
}

describe("item normalization and fingerprints", () => {
  it("sorts identity inputs deterministically", () => {
    const first = normalizeItemVariant(item());
    const second = normalizeItemVariant(item({
      enchantments: { "minecraft:mending": 1n, "minecraft:sharpness": 5n },
    }));
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.completeness.classification).toBe("strong_match");
    expect(canonicalJson({ z: 1, a: 2 })).toBe('{"a":2,"z":1}');
  });

  it("marks potions and missing enchantment data as ambiguous", () => {
    const potion = normalizeItemVariant(item({
      id: "minecraft:potion",
      enchantments: null,
      fieldStates: { ...states, enchantments: "null" },
    }));
    expect(potion.completeness.classification).toBe("ambiguous");
    expect(potion.completeness.suitableForExactAnalytics).toBe(false);
  });

  it("does not include top-level stack count in variant identity", () => {
    expect(normalizeItemVariant(item({ count: 1n })).fingerprint)
      .toBe(normalizeItemVariant(item({ count: 64n })).fingerprint);
  });

  it("preserves identical sales as a multiset with collision ordinals", () => {
    const tx = createTransactionFingerprint({
      sourceId: "mirror",
      itemVariantFingerprint: normalizeItemVariant(item()).fingerprint,
      sellerUuid: "ABC",
      sellerName: "Seller",
      totalPrice: "9007199254740993",
      quantity: 1,
      soldAtUnixMs: "1788290000000",
    });
    const records = assignTransactionOccurrenceOrdinals(["a", "b"], () => tx.value);
    expect(records.map((entry) => entry.occurrenceOrdinal)).toEqual([1, 2]);
    expect(records.every((entry) => entry.collisionAmbiguous)).toBe(true);
    expect(records[0]!.occurrenceKey).not.toBe(records[1]!.occurrenceKey);
  });

  it("labels listing linkage as probabilistic", () => {
    const fingerprint = createListingObservationFingerprint({
      sourceId: "mirror",
      itemVariantFingerprint: normalizeItemVariant(item()).fingerprint,
      sellerUuid: "abc",
      sellerName: "seller",
      totalPrice: "50",
      quantity: 1,
      observedAtUnixMs: 1_000_000n,
      timeLeftMs: 30_000n,
    });
    expect(fingerprint.kind).toBe("probabilistic");
    expect(fingerprint.stableIdentity).toBe(false);
    expect(fingerprint.uncertaintyReasons).toContain("identical_listings_can_share_a_fingerprint");
  });
});
