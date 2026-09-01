import { createHash } from "node:crypto";
import type { Item } from "./upstream-types";

function normalizeWhitespace(s: string): string {
  return s
    .replace(/\u00a7[0-9a-fk-or]/gi, "")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeName(name: string | null | undefined): string {
  return normalizeWhitespace(name ?? "");
}

function sortedLevels(
  levels: Record<string, number | null | undefined> | null | undefined,
): Array<[string, number]> {
  if (!levels) return [];
  return Object.entries(levels)
    .filter((entry): entry is [string, number] => entry[1] != null)
    .map(([k, v]) => [k.toLowerCase(), v] as [string, number])
    .sort((a, b) => a[0].localeCompare(b[0]));
}

interface CanonicalContent {
  id: string;
  name: string;
  count: number;
  enchants: Array<[string, number]>;
}

function canonicalContents(
  contents: Item["contents"],
): CanonicalContent[] {
  if (!contents || contents.length === 0) return [];
  return contents
    .map((c) => ({
      id: c.id ?? "",
      name: normalizeName(c.display_name),
      count: Math.max(c.count ?? 1, 1),
      enchants: sortedLevels(c.enchants?.enchantments?.levels),
    }))
    .sort((a, b) => {
      const idCmp = a.id.localeCompare(b.id);
      if (idCmp !== 0) return idCmp;
      const nameCmp = a.name.localeCompare(b.name);
      if (nameCmp !== 0) return nameCmp;
      return a.count - b.count;
    });
}

export interface CanonicalVariant {
  baseItemId: string;
  normalizedDisplayName: string;
  enchantments: Array<[string, number]>;
  trim: { material: string; pattern: string } | null;
  lore: string[];
  contents: CanonicalContent[];
}

export function buildCanonicalVariant(item: Item): CanonicalVariant {
  const enchLevels = item.enchants?.enchantments?.levels ?? undefined;
  const trim = item.enchants?.trim ?? item.trim;
  return {
    baseItemId: item.id ?? "unknown",
    normalizedDisplayName: normalizeName(item.display_name),
    enchantments: sortedLevels(enchLevels),
    trim:
      trim && (trim.material || trim.pattern)
        ? {
            material: normalizeWhitespace(trim.material ?? ""),
            pattern: normalizeWhitespace(trim.pattern ?? ""),
          }
        : null,
    lore: (item.lore ?? []).map((l) => normalizeWhitespace(l)),
    contents: canonicalContents(item.contents),
  };
}

export function canonicalJson(variant: CanonicalVariant): string {
  return JSON.stringify(variant);
}

export function variantHash(variant: CanonicalVariant): string {
  return createHash("sha256").update(canonicalJson(variant)).digest("hex");
}

export interface NormalizedItem {
  baseItemId: string;
  displayName: string;
  normalizedDisplayName: string;
  variantHash: string;
  canonical: CanonicalVariant;
  canonicalJson: string;
  quantity: number;
}

export function normalizeItem(item: Item): NormalizedItem {
  const canonical = buildCanonicalVariant(item);
  const json = canonicalJson(canonical);
  return {
    baseItemId: canonical.baseItemId,
    displayName: item.display_name || canonical.baseItemId,
    normalizedDisplayName: canonical.normalizedDisplayName,
    variantHash: variantHash(canonical),
    canonical,
    canonicalJson: json,
    quantity: Math.max(item.count ?? 1, 1),
  };
}

export function transactionDedupeHash(input: {
  soldAtMs: number;
  sellerUuid: string;
  sellerName: string;
  variantHash: string;
  quantity: number;
  totalPrice: string;
  occurrence: number;
}): string {
  const canonical = JSON.stringify([
    input.soldAtMs,
    input.sellerUuid,
    input.sellerName,
    input.variantHash,
    input.quantity,
    input.totalPrice,
    input.occurrence,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}
