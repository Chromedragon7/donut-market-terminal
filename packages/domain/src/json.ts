import { createHash } from "node:crypto";

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

function encode(value: JsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON cannot encode a non-finite number");
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => encode(entry)).join(",")}]`;

  const object = value as { readonly [key: string]: JsonValue };
  const members = Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${encode(object[key]!)}`);
  return `{${members.join(",")}}`;
}

/** Stable JSON for already-normalized, JSON-safe domain data. */
export function canonicalJson(value: JsonValue): string {
  return encode(value);
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function fingerprintJson(value: JsonValue): string {
  return sha256Hex(canonicalJson(value));
}
