export type Scope = "base" | "variant";

export interface ParsedScope {
  scope: Scope;
  value: string;
}

export function baseScopeKey(itemId: string): string {
  return `base:${itemId}`;
}

export function variantScopeKey(variantHash: string): string {
  return `variant:${variantHash}`;
}

export function parseScopeKey(scopeKey: string): ParsedScope {
  const idx = scopeKey.indexOf(":");
  if (idx === -1) {
    return { scope: "base", value: scopeKey };
  }
  const prefix = scopeKey.slice(0, idx);
  const value = scopeKey.slice(idx + 1);
  if (prefix === "variant") return { scope: "variant", value };
  return { scope: "base", value };
}
