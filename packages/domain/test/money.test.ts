import { describe, expect, it } from "vitest";
import {
  calculateStackPricing,
  decimalAmount,
  decimalToString,
  rationalToFixed,
  rationalToString,
} from "../src/index.js";

describe("exact money", () => {
  it("preserves decimal and exponent lexemes beyond JavaScript safe integers", () => {
    expect(decimalToString(decimalAmount("9007199254740993.12500"))).toBe("9007199254740993.125");
    expect(decimalToString(decimalAmount("1.25e3"))).toBe("1250");
    expect(() => decimalAmount(9_007_199_254_740_992)).toThrow(/safe integers/);
    expect(() => decimalAmount(0.1)).toThrow(/safe integers/);
  });

  it("keeps non-terminating unit prices as exact fractions", () => {
    const pricing = calculateStackPricing("10000000000000000", 3n);
    expect(pricing.totalCanonical).toBe("10000000000000000");
    expect(pricing.unitCanonical).toBe("10000000000000000/3");
    expect(rationalToFixed(pricing.unit, 2)).toBe("3333333333333333.33");
  });

  it("formats terminating ratios without rounding", () => {
    const pricing = calculateStackPricing("10.5", 4);
    expect(rationalToString(pricing.unit)).toBe("2.625");
  });

  it("rejects zero quantity and negative money", () => {
    expect(() => calculateStackPricing("1", 0)).toThrow(/positive/);
    expect(() => calculateStackPricing("-1", 1)).toThrow(/negative/);
  });
});
