export interface DecimalAmount {
  /** Signed base-10 coefficient. Numeric value is atoms * 10^-scale. */
  readonly atoms: bigint;
  readonly scale: number;
}

export interface RationalAmount {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

export type DecimalInput = DecimalAmount | bigint | number | string;

const DECIMAL_PATTERN = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;
const MAX_SCALE = 1_000;

function powerOfTen(exponent: number): bigint {
  if (!Number.isSafeInteger(exponent) || exponent < 0 || exponent > MAX_SCALE) {
    throw new RangeError(`Decimal scale must be between 0 and ${MAX_SCALE}`);
  }
  return 10n ** BigInt(exponent);
}

function normalizeDecimal(atoms: bigint, scale: number): DecimalAmount {
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > MAX_SCALE) {
    throw new RangeError(`Decimal scale must be between 0 and ${MAX_SCALE}`);
  }
  let normalizedAtoms = atoms;
  let normalizedScale = scale;
  while (normalizedScale > 0 && normalizedAtoms % 10n === 0n) {
    normalizedAtoms /= 10n;
    normalizedScale -= 1;
  }
  return Object.freeze({ atoms: normalizedAtoms, scale: normalizedScale });
}

/**
 * Parses exact decimal text. Number inputs are deliberately restricted to safe
 * integers so an already-rounded IEEE-754 value cannot silently enter storage.
 */
export function decimalAmount(input: DecimalInput): DecimalAmount {
  if (typeof input === "object") return normalizeDecimal(input.atoms, input.scale);
  if (typeof input === "bigint") return Object.freeze({ atoms: input, scale: 0 });
  if (typeof input === "number") {
    if (!Number.isSafeInteger(input)) {
      throw new TypeError("Number money inputs must be safe integers; pass the original decimal lexeme as a string");
    }
    return Object.freeze({ atoms: BigInt(input), scale: 0 });
  }

  const match = DECIMAL_PATTERN.exec(input.trim());
  if (!match) throw new TypeError(`Invalid decimal amount: ${input}`);
  const sign = match[1] === "-" ? -1n : 1n;
  const integer = match[2]!;
  const fraction = match[3] ?? "";
  const exponent = Number(match[4] ?? "0");
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_SCALE) {
    throw new RangeError(`Decimal exponent must be between -${MAX_SCALE} and ${MAX_SCALE}`);
  }

  let atoms = sign * BigInt(`${integer}${fraction}`);
  let scale = fraction.length - exponent;
  if (scale < 0) {
    atoms *= powerOfTen(-scale);
    scale = 0;
  }
  return normalizeDecimal(atoms, scale);
}

export function decimalToString(value: DecimalAmount): string {
  const normalized = normalizeDecimal(value.atoms, value.scale);
  const negative = normalized.atoms < 0n;
  const digits = (negative ? -normalized.atoms : normalized.atoms).toString();
  if (normalized.scale === 0) return `${negative ? "-" : ""}${digits}`;
  const padded = digits.padStart(normalized.scale + 1, "0");
  const split = padded.length - normalized.scale;
  return `${negative ? "-" : ""}${padded.slice(0, split)}.${padded.slice(split)}`;
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}

export function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = absolute(left);
  let b = absolute(right);
  while (b !== 0n) [a, b] = [b, a % b];
  return a === 0n ? 1n : a;
}

export function rationalAmount(numerator: bigint, denominator: bigint = 1n): RationalAmount {
  if (denominator === 0n) throw new RangeError("A rational amount cannot have a zero denominator");
  const sign = denominator < 0n ? -1n : 1n;
  const divisor = greatestCommonDivisor(numerator, denominator);
  return Object.freeze({
    numerator: (numerator / divisor) * sign,
    denominator: absolute(denominator / divisor),
  });
}

export function decimalToRational(value: DecimalAmount): RationalAmount {
  return rationalAmount(value.atoms, powerOfTen(value.scale));
}

export function addRationals(left: RationalAmount, right: RationalAmount): RationalAmount {
  return rationalAmount(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

export function subtractRationals(left: RationalAmount, right: RationalAmount): RationalAmount {
  return rationalAmount(
    left.numerator * right.denominator - right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

export function multiplyRational(value: RationalAmount, multiplier: bigint): RationalAmount {
  return rationalAmount(value.numerator * multiplier, value.denominator);
}

export function divideRational(value: RationalAmount, divisor: bigint): RationalAmount {
  if (divisor === 0n) throw new RangeError("Cannot divide money by zero");
  return rationalAmount(value.numerator, value.denominator * divisor);
}

export function compareRationals(left: RationalAmount, right: RationalAmount): -1 | 0 | 1 {
  const difference = left.numerator * right.denominator - right.numerator * left.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function terminatingScale(denominator: bigint): number | null {
  let value = denominator;
  let twos = 0;
  let fives = 0;
  while (value % 2n === 0n) { value /= 2n; twos += 1; }
  while (value % 5n === 0n) { value /= 5n; fives += 1; }
  return value === 1n ? Math.max(twos, fives) : null;
}

/** Uses a decimal when it terminates; otherwise preserves the exact fraction. */
export function rationalToString(value: RationalAmount): string {
  const normalized = rationalAmount(value.numerator, value.denominator);
  const scale = terminatingScale(normalized.denominator);
  if (scale === null || scale > MAX_SCALE) return `${normalized.numerator}/${normalized.denominator}`;
  const multiplier = powerOfTen(scale) / normalized.denominator;
  return decimalToString({ atoms: normalized.numerator * multiplier, scale });
}

export type RoundingMode = "down" | "half-up" | "up";

export function rationalToFixed(
  value: RationalAmount,
  fractionDigits: number,
  rounding: RoundingMode = "half-up",
): string {
  const normalized = rationalAmount(value.numerator, value.denominator);
  const scale = powerOfTen(fractionDigits);
  const scaledNumerator = normalized.numerator * scale;
  let quotient = scaledNumerator / normalized.denominator;
  const remainder = absolute(scaledNumerator % normalized.denominator);
  if (remainder !== 0n) {
    const direction = normalized.numerator < 0n ? -1n : 1n;
    if (rounding === "up" || (rounding === "half-up" && remainder * 2n >= normalized.denominator)) {
      quotient += direction;
    }
  }
  const fixed = decimalToString({ atoms: quotient, scale: fractionDigits });
  if (fractionDigits === 0) return fixed;
  const [integer, fraction = ""] = fixed.split(".");
  return `${integer}.${fraction.padEnd(fractionDigits, "0")}`;
}

function positiveQuantity(input: bigint | number): bigint {
  if (typeof input === "number" && !Number.isSafeInteger(input)) {
    throw new TypeError("Quantity must be a safe integer or bigint");
  }
  const quantity = typeof input === "bigint" ? input : BigInt(input);
  if (quantity <= 0n) throw new RangeError("Quantity must be a positive integer");
  return quantity;
}

export interface StackPricing {
  readonly total: DecimalAmount;
  readonly totalCanonical: string;
  readonly quantity: bigint;
  readonly unit: RationalAmount;
  readonly unitCanonical: string;
}

export function calculateStackPricing(totalInput: DecimalInput, quantityInput: bigint | number): StackPricing {
  const total = decimalAmount(totalInput);
  if (total.atoms < 0n) throw new RangeError("Money cannot be negative");
  const quantity = positiveQuantity(quantityInput);
  const unit = divideRational(decimalToRational(total), quantity);
  return Object.freeze({
    total,
    totalCanonical: decimalToString(total),
    quantity,
    unit,
    unitCanonical: rationalToString(unit),
  });
}
