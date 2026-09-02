import { describe, expect, it } from "vitest";
import {
  duplicateTransactionsBody,
  listingNullPaddingBody,
  malformedJsonBody,
  nullEnchantLevelsBody,
} from "../src/index.js";

describe("representative compatible API fixtures", () => {
  it("keeps precision-sensitive JSON as source text", () => {
    expect(listingNullPaddingBody).toContain("900719925474099312345.125");
    expect(listingNullPaddingBody).toContain(",null,null]");
  });

  it("captures collision and missing-metadata cases", () => {
    expect(duplicateTransactionsBody.match(/unixMillisDateSold/g)).toHaveLength(2);
    expect(nullEnchantLevelsBody).toContain(String.raw`"levels":null`);
    expect(malformedJsonBody.endsWith("[")).toBe(true);
  });
});
