import {
  baseScopeKey,
  variantScopeKey,
  type CanonicalVariant,
} from "@workspace/donut";

export interface VariantMeta {
  id: number;
  baseItemId: string;
  displayName: string;
  variantHash: string;
  enchantmentsJson: unknown;
  trimJson: unknown;
  loreJson: unknown;
}

export function enchantsOf(enchantmentsJson: unknown): Array<{
  name: string;
  level: number;
}> {
  if (!Array.isArray(enchantmentsJson)) return [];
  const out: Array<{ name: string; level: number }> = [];
  for (const entry of enchantmentsJson) {
    if (Array.isArray(entry) && entry.length === 2) {
      out.push({ name: String(entry[0]), level: Number(entry[1]) });
    }
  }
  return out;
}

export function trimOf(trimJson: unknown): {
  material: string | null;
  pattern: string | null;
} {
  if (
    trimJson &&
    typeof trimJson === "object" &&
    "material" in trimJson
  ) {
    const t = trimJson as CanonicalVariant["trim"];
    return {
      material: t?.material ?? null,
      pattern: t?.pattern ?? null,
    };
  }
  return { material: null, pattern: null };
}

export function loreOf(loreJson: unknown): string[] {
  return Array.isArray(loreJson) ? loreJson.map((l) => String(l)) : [];
}

export function scopeKeyFor(meta: {
  scope: "base" | "variant";
  baseItemId: string;
  variantHash: string;
}): string {
  return meta.scope === "variant"
    ? variantScopeKey(meta.variantHash)
    : baseScopeKey(meta.baseItemId);
}
