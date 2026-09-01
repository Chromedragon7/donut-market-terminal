import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

export function toDecimal(value: string | number | Decimal): Decimal {
  return value instanceof Decimal ? value : new Decimal(value);
}

export function unitPrice(
  totalPrice: string | number,
  quantity: number,
): string {
  const qty = Math.max(quantity, 1);
  return new Decimal(totalPrice).div(qty).toFixed();
}

export function sumDecimals(values: Array<string | number>): string {
  return values
    .reduce<Decimal>((acc, v) => acc.plus(v), new Decimal(0))
    .toFixed();
}

export function multiply(a: string | number, b: string | number): string {
  return new Decimal(a).mul(b).toFixed();
}

const UNITS = ["", "K", "M", "B", "T", "Q"];

export function formatCompact(value: string | number): string {
  const d = new Decimal(value);
  if (d.isZero()) return "0";
  const neg = d.isNegative();
  let abs = d.abs();
  let unitIdx = 0;
  while (abs.gte(1000) && unitIdx < UNITS.length - 1) {
    abs = abs.div(1000);
    unitIdx += 1;
  }
  const formatted = abs.toDecimalPlaces(2).toString();
  return `${neg ? "-" : ""}${formatted}${UNITS[unitIdx]}`;
}

export function formatExact(value: string | number): string {
  return new Decimal(value).toFixed();
}
