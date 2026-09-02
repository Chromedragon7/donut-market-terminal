import { canonicalJson, fingerprintJson, type JsonValue } from "./json.js";

export type MetadataFieldState = "absent" | "null" | "present";
export type MetadataCoverage = "complete" | "partial" | "unknown";
export type VariantCompletenessClass =
  | "exact_match"
  | "strong_match"
  | "broad_base_item_match"
  | "incomplete_metadata"
  | "ambiguous"
  | "unclassified"
  | "excluded_from_analytics";

export interface SourceTrim {
  readonly material: string | null;
  readonly pattern: string | null;
}

export interface SourceItemFieldStates {
  readonly displayName: MetadataFieldState;
  readonly lore: MetadataFieldState;
  readonly enchantments: MetadataFieldState;
  readonly trim: MetadataFieldState;
  readonly contents: MetadataFieldState;
}

export interface SourceItemForNormalization {
  readonly id: string | null;
  readonly count: bigint | null;
  readonly displayName: string | null;
  readonly lore: readonly string[] | null;
  readonly enchantments: Readonly<Record<string, bigint>> | null;
  readonly trim: SourceTrim | null;
  readonly contents: readonly (SourceItemForNormalization | null)[] | null;
  readonly fieldStates: SourceItemFieldStates;
  readonly metadataCoverage: MetadataCoverage;
  readonly forceExcluded?: boolean;
}

export interface VariantCompleteness {
  readonly classification: VariantCompletenessClass;
  readonly reasons: readonly string[];
  readonly suitableForExactAnalytics: boolean;
}

export interface CanonicalItemVariant {
  readonly schemaVersion: "item-variant/v1";
  readonly baseItemId: string | null;
  readonly sourceItemId: string | null;
  readonly quantity: bigint | null;
  readonly displayName: string | null;
  readonly lore: readonly string[] | null;
  readonly enchantments: Readonly<Record<string, bigint>> | null;
  readonly trim: Readonly<SourceTrim> | null;
  readonly contents: readonly (CanonicalItemVariant | null)[] | null;
  readonly completeness: VariantCompleteness;
  readonly identityJson: string;
  readonly fingerprint: string;
}

const COMPONENT_SENSITIVE_ITEMS = new Set([
  "minecraft:bundle",
  "minecraft:enchanted_book",
  "minecraft:filled_map",
  "minecraft:firework_rocket",
  "minecraft:firework_star",
  "minecraft:goat_horn",
  "minecraft:lingering_potion",
  "minecraft:player_head",
  "minecraft:potion",
  "minecraft:splash_potion",
  "minecraft:suspicious_stew",
  "minecraft:tipped_arrow",
  "minecraft:written_book",
]);

const ITEM_ID = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;

function text(value: string): string {
  return value.normalize("NFC");
}

export function normalizeItemId(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim().toLowerCase();
  const namespaced = trimmed.includes(":") ? trimmed : `minecraft:${trimmed}`;
  return ITEM_ID.test(namespaced) ? namespaced : null;
}

function normalizeOptionalName(value: string | null): string | null {
  if (value === null || value.length === 0) return null;
  return text(value);
}

function normalizeEnchantments(
  value: Readonly<Record<string, bigint>> | null,
  reasons: string[],
): Readonly<Record<string, bigint>> | null {
  if (value === null) return null;
  const normalized: Record<string, bigint> = {};
  for (const [rawId, level] of Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    const id = normalizeItemId(rawId);
    if (id === null || level <= 0n) {
      reasons.push("invalid_enchantment_entry");
      continue;
    }
    normalized[id] = level;
  }
  return Object.freeze(normalized);
}

function normalizeTrim(value: SourceTrim | null): Readonly<SourceTrim> | null {
  if (value === null) return null;
  const material = normalizeItemId(value.material);
  const pattern = normalizeItemId(value.pattern);
  if (material === null && pattern === null) return null;
  return Object.freeze({ material, pattern });
}

function stateJson(states: SourceItemFieldStates): JsonValue {
  return {
    contents: states.contents,
    displayName: states.displayName,
    enchantments: states.enchantments,
    lore: states.lore,
    trim: states.trim,
  };
}

function variantIdentity(
  baseItemId: string | null,
  sourceItemId: string | null,
  displayName: string | null,
  lore: readonly string[] | null,
  enchantments: Readonly<Record<string, bigint>> | null,
  trim: Readonly<SourceTrim> | null,
  contents: readonly (CanonicalItemVariant | null)[] | null,
  states: SourceItemFieldStates,
): JsonValue {
  const enchantmentJson: { [key: string]: JsonValue } | null = enchantments === null
    ? null
    : Object.fromEntries(Object.entries(enchantments).map(([id, level]) => [id, level.toString()]));
  return {
    baseItemId,
    contents: contents?.map((entry) => entry === null
      ? null
      : { count: entry.quantity?.toString() ?? null, variantFingerprint: entry.fingerprint }) ?? null,
    displayName,
    enchantments: enchantmentJson,
    fieldStates: stateJson(states),
    lore,
    schemaVersion: "item-variant/v1",
    sourceItemId: baseItemId === null ? sourceItemId : null,
    trim: trim === null ? null : { material: trim.material, pattern: trim.pattern },
  };
}

function completeness(
  item: SourceItemForNormalization,
  baseItemId: string | null,
  hasMeaningfulMetadata: boolean,
  reasons: string[],
): VariantCompleteness {
  if (item.forceExcluded === true) {
    reasons.push("source_explicitly_excluded");
    return Object.freeze({
      classification: "excluded_from_analytics",
      reasons: Object.freeze([...new Set(reasons)]),
      suitableForExactAnalytics: false,
    });
  }
  if (baseItemId === null) {
    reasons.push("missing_or_invalid_item_id");
    return Object.freeze({
      classification: "unclassified",
      reasons: Object.freeze([...new Set(reasons)]),
      suitableForExactAnalytics: false,
    });
  }

  const unavailableFields = Object.entries(item.fieldStates)
    .filter(([, state]) => state !== "present")
    .map(([field, state]) => `${field}_${state}`);
  reasons.push(...unavailableFields);

  if (COMPONENT_SENSITIVE_ITEMS.has(baseItemId)) {
    reasons.push("item_requires_unavailable_data_components");
    return Object.freeze({
      classification: "ambiguous",
      reasons: Object.freeze([...new Set(reasons)]),
      suitableForExactAnalytics: false,
    });
  }

  if (item.fieldStates.enchantments !== "present") {
    reasons.push("enchantment_identity_unavailable");
    return Object.freeze({
      classification: "ambiguous",
      reasons: Object.freeze([...new Set(reasons)]),
      suitableForExactAnalytics: false,
    });
  }

  if (item.metadataCoverage === "unknown" || unavailableFields.length > 0) {
    reasons.push(`metadata_coverage_${item.metadataCoverage}`);
    return Object.freeze({
      classification: "incomplete_metadata",
      reasons: Object.freeze([...new Set(reasons)]),
      suitableForExactAnalytics: false,
    });
  }

  if (item.metadataCoverage === "complete") {
    return Object.freeze({
      classification: "exact_match",
      reasons: Object.freeze([...new Set(reasons)]),
      suitableForExactAnalytics: true,
    });
  }

  return Object.freeze({
    classification: hasMeaningfulMetadata ? "strong_match" : "broad_base_item_match",
    reasons: Object.freeze([...new Set(reasons), "provider_does_not_expose_all_data_components"]),
    suitableForExactAnalytics: false,
  });
}

export interface NormalizeItemOptions {
  readonly maxContainerDepth?: number;
}

function normalizeItem(
  item: SourceItemForNormalization,
  options: Required<NormalizeItemOptions>,
  depth: number,
): CanonicalItemVariant {
  const reasons: string[] = [];
  const baseItemId = normalizeItemId(item.id);
  const sourceItemId = item.id === null ? null : text(item.id);
  const displayName = normalizeOptionalName(item.displayName);
  const lore = item.lore?.map(text) ?? null;
  const enchantments = normalizeEnchantments(item.enchantments, reasons);
  const trim = normalizeTrim(item.trim);

  let contents: readonly (CanonicalItemVariant | null)[] | null = null;
  if (item.contents !== null) {
    if (depth >= options.maxContainerDepth) {
      reasons.push("container_depth_truncated");
    } else {
      contents = Object.freeze(item.contents.map((entry) => entry === null ? null : normalizeItem(entry, options, depth + 1)));
    }
  }

  const hasMeaningfulMetadata = displayName !== null
    || (lore?.length ?? 0) > 0
    || Object.keys(enchantments ?? {}).length > 0
    || trim !== null
    || (contents?.length ?? 0) > 0;
  const variantCompleteness = completeness(item, baseItemId, hasMeaningfulMetadata, reasons);
  const identity = variantIdentity(
    baseItemId,
    sourceItemId,
    displayName,
    lore,
    enchantments,
    trim,
    contents,
    item.fieldStates,
  );
  const identityJson = canonicalJson(identity);

  return Object.freeze({
    schemaVersion: "item-variant/v1",
    baseItemId,
    sourceItemId,
    quantity: item.count,
    displayName,
    lore: lore === null ? null : Object.freeze(lore),
    enchantments,
    trim,
    contents,
    completeness: variantCompleteness,
    identityJson,
    fingerprint: fingerprintJson(identity),
  });
}

export function normalizeItemVariant(
  item: SourceItemForNormalization,
  options: NormalizeItemOptions = {},
): CanonicalItemVariant {
  const maxContainerDepth = options.maxContainerDepth ?? 4;
  if (!Number.isSafeInteger(maxContainerDepth) || maxContainerDepth < 0 || maxContainerDepth > 16) {
    throw new RangeError("maxContainerDepth must be an integer from 0 through 16");
  }
  return normalizeItem(item, { maxContainerDepth }, 0);
}
