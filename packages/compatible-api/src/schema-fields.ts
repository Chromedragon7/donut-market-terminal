import { decimalAmount, normalizeItemId, type SourceItemForNormalization, type SourceTrim } from "@donut/domain";
import { isLosslessJsonNumber } from "./lossless-json.js";
import type {
  CompatibleSeller,
  RecordValidationState,
  ValidationIssue,
  ValidationSeverity,
} from "./types.js";

export type UnknownRecord = { readonly [key: string]: unknown };

function actualType(value: unknown): string {
  if (isLosslessJsonNumber(value)) return "number";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export class IssueCollector {
  private readonly mutable: ValidationIssue[] = [];

  add(path: string, code: string, severity: ValidationSeverity, message: string, actual?: unknown): void {
    this.mutable.push(Object.freeze({
      path,
      code,
      severity,
      message,
      ...(actual === undefined ? {} : { actualType: actualType(actual) }),
    }));
  }

  unknownKeys(value: UnknownRecord, known: readonly string[], path: string): void {
    const allowed = new Set(known);
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) this.add(`${path}.${key}`, "unknown_field", "info", "Unknown field preserved in raw evidence");
    }
  }

  snapshot(): readonly ValidationIssue[] {
    return Object.freeze([...this.mutable]);
  }
}

export function isObject(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !isLosslessJsonNumber(value);
}

export function integerValue(value: unknown): bigint | null {
  if (isLosslessJsonNumber(value)) return /^-?\d+$/.test(value.lexeme) ? BigInt(value.lexeme) : null;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return Number.isSafeInteger(value) ? BigInt(value) : null;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  return null;
}

export function decimalLexeme(value: unknown): string | null {
  if (isLosslessJsonNumber(value)) return value.lexeme;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return Number.isSafeInteger(value) ? String(value) : null;
  if (typeof value === "string") return value;
  return null;
}

function fieldState(object: UnknownRecord, key: string): "absent" | "null" | "present" {
  if (!Object.prototype.hasOwnProperty.call(object, key)) return "absent";
  return object[key] === null ? "null" : "present";
}

function stringField(
  object: UnknownRecord,
  key: string,
  path: string,
  issues: IssueCollector,
  severity: ValidationSeverity = "warning",
): string | null {
  const value = object[key];
  if (typeof value === "string") return value;
  issues.add(`${path}.${key}`, `invalid_${key}`, severity, `${key} must be a string`, value);
  return null;
}

function parseLore(object: UnknownRecord, path: string, issues: IssueCollector): readonly string[] | null {
  const raw = object.lore;
  if (!Array.isArray(raw)) {
    if (raw !== undefined && raw !== null) issues.add(`${path}.lore`, "invalid_lore", "warning", "lore must be an array", raw);
    return null;
  }
  const lore: string[] = [];
  raw.forEach((line, index) => {
    if (typeof line === "string") lore.push(line);
    else issues.add(`${path}.lore[${index}]`, "invalid_lore_line", "warning", "Lore line must be a string", line);
  });
  return Object.freeze(lore);
}

function parseEnchantments(
  enchants: UnknownRecord | null,
  path: string,
  issues: IssueCollector,
): { readonly value: Readonly<Record<string, bigint>> | null; readonly state: "absent" | "null" | "present" } {
  if (enchants === null) return { value: null, state: "null" };
  if (!Object.prototype.hasOwnProperty.call(enchants, "enchantments")) return { value: null, state: "absent" };
  const wrapper = enchants.enchantments;
  if (wrapper === null) return { value: null, state: "null" };
  if (!isObject(wrapper)) {
    issues.add(`${path}.enchants.enchantments`, "invalid_enchantments", "warning", "enchantments must be an object", wrapper);
    return { value: null, state: "null" };
  }
  if (!Object.prototype.hasOwnProperty.call(wrapper, "levels")) return { value: null, state: "absent" };
  const levels = wrapper.levels;
  if (levels === null) {
    issues.add(`${path}.enchants.enchantments.levels`, "enchantment_levels_unavailable", "warning", "Upstream returned null enchantment levels", levels);
    return { value: null, state: "null" };
  }
  if (!isObject(levels)) {
    issues.add(`${path}.enchants.enchantments.levels`, "invalid_enchantment_levels", "warning", "levels must be an object or null", levels);
    return { value: null, state: "null" };
  }
  const result: Record<string, bigint> = {};
  for (const [id, rawLevel] of Object.entries(levels)) {
    const level = integerValue(rawLevel);
    if (level === null || level <= 0n) {
      issues.add(`${path}.enchants.enchantments.levels.${id}`, "invalid_enchantment_level", "warning", "Enchantment level must be a positive integer", rawLevel);
      continue;
    }
    result[id] = level;
  }
  return { value: Object.freeze(result), state: "present" };
}

function parseTrim(
  enchants: UnknownRecord | null,
  path: string,
  issues: IssueCollector,
): { readonly value: SourceTrim | null; readonly state: "absent" | "null" | "present" } {
  if (enchants === null) return { value: null, state: "null" };
  if (!Object.prototype.hasOwnProperty.call(enchants, "trim")) return { value: null, state: "absent" };
  const raw = enchants.trim;
  if (raw === null) return { value: null, state: "null" };
  if (!isObject(raw)) {
    issues.add(`${path}.enchants.trim`, "invalid_trim", "warning", "trim must be an object", raw);
    return { value: null, state: "null" };
  }
  const material = typeof raw.material === "string" && raw.material.length > 0 ? raw.material : null;
  const pattern = typeof raw.pattern === "string" && raw.pattern.length > 0 ? raw.pattern : null;
  if (raw.material !== undefined && raw.material !== null && typeof raw.material !== "string") {
    issues.add(`${path}.enchants.trim.material`, "invalid_trim_material", "warning", "trim material must be a string", raw.material);
  }
  if (raw.pattern !== undefined && raw.pattern !== null && typeof raw.pattern !== "string") {
    issues.add(`${path}.enchants.trim.pattern`, "invalid_trim_pattern", "warning", "trim pattern must be a string", raw.pattern);
  }
  return { value: Object.freeze({ material, pattern }), state: "present" };
}

function containerCapable(id: string | null): boolean {
  const normalized = normalizeItemId(id);
  return normalized === "minecraft:bundle" || normalized?.endsWith("_shulker_box") === true;
}

function parseContents(
  object: UnknownRecord,
  id: string | null,
  path: string,
  issues: IssueCollector,
  depth: number,
): {
  readonly value: readonly (SourceItemForNormalization | null)[] | null;
  readonly state: "absent" | "null" | "present";
} {
  if (!Object.prototype.hasOwnProperty.call(object, "contents")) {
    return containerCapable(id) ? { value: null, state: "absent" } : { value: Object.freeze([]), state: "present" };
  }
  const raw = object.contents;
  if (raw === null) return { value: null, state: "null" };
  if (!Array.isArray(raw)) {
    issues.add(`${path}.contents`, "invalid_contents", "warning", "contents must be an array or null", raw);
    return { value: null, state: "null" };
  }
  if (depth >= 8) {
    issues.add(`${path}.contents`, "contents_depth_exceeded", "warning", "Nested contents exceeded validation depth");
    return { value: null, state: "null" };
  }
  return {
    value: Object.freeze(raw.map((entry, index) => entry === null
      ? null
      : parseSourceItem(entry, `${path}.contents[${index}]`, issues, depth + 1))),
    state: "present",
  };
}

export function parseSourceItem(
  raw: unknown,
  path: string,
  issues: IssueCollector,
  depth = 0,
): SourceItemForNormalization | null {
  if (!isObject(raw)) {
    issues.add(path, "invalid_item", "error", "item must be an object", raw);
    return null;
  }
  issues.unknownKeys(raw, ["contents", "count", "display_name", "enchants", "id", "lore"], path);
  const id = stringField(raw, "id", path, issues, "error");
  const rawCount = integerValue(raw.count);
  const count = rawCount !== null && rawCount > 0n ? rawCount : null;
  if (count === null) issues.add(`${path}.count`, "invalid_item_count", "error", "count must be a positive integer", raw.count);
  const displayName = typeof raw.display_name === "string" ? raw.display_name : null;
  if (displayName === null && raw.display_name !== undefined && raw.display_name !== null) {
    issues.add(`${path}.display_name`, "invalid_display_name", "warning", "display_name must be a string", raw.display_name);
  }
  const lore = parseLore(raw, path, issues);
  const rawEnchants = raw.enchants;
  const enchants = isObject(rawEnchants) ? rawEnchants : null;
  if (rawEnchants !== undefined && rawEnchants !== null && enchants === null) {
    issues.add(`${path}.enchants`, "invalid_enchants", "warning", "enchants must be an object or null", rawEnchants);
  }
  if (enchants !== null) issues.unknownKeys(enchants, ["enchantments", "trim"], `${path}.enchants`);
  const parsedEnchantments = parseEnchantments(enchants, path, issues);
  const parsedTrim = parseTrim(enchants, path, issues);
  const parsedContents = parseContents(raw, id, path, issues, depth);

  return Object.freeze({
    id,
    count,
    displayName,
    lore,
    enchantments: parsedEnchantments.value,
    trim: parsedTrim.value,
    contents: parsedContents.value,
    fieldStates: Object.freeze({
      displayName: fieldState(raw, "display_name"),
      lore: fieldState(raw, "lore"),
      enchantments: rawEnchants === undefined ? "absent" : rawEnchants === null ? "null" : parsedEnchantments.state,
      trim: rawEnchants === undefined ? "absent" : rawEnchants === null ? "null" : parsedTrim.state,
      contents: parsedContents.state,
    }),
    metadataCoverage: "partial",
  });
}

export function parseSeller(raw: unknown, path: string, issues: IssueCollector): CompatibleSeller {
  if (!isObject(raw)) {
    issues.add(path, "invalid_seller", "warning", "seller must be an object", raw);
    return Object.freeze({ name: null, uuid: null });
  }
  issues.unknownKeys(raw, ["name", "uuid"], path);
  const name = typeof raw.name === "string" && raw.name.length > 0 ? raw.name : null;
  const uuid = typeof raw.uuid === "string" && raw.uuid.length > 0 ? raw.uuid.toLowerCase() : null;
  if (name === null) issues.add(`${path}.name`, "missing_seller_name", "warning", "Seller name is missing", raw.name);
  if (uuid === null) issues.add(`${path}.uuid`, "missing_seller_uuid", "warning", "Seller UUID is missing", raw.uuid);
  else if (!/^[0-9a-f]{32}$|^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(uuid)) {
    issues.add(`${path}.uuid`, "nonstandard_seller_uuid", "warning", "Seller UUID has a nonstandard shape", raw.uuid);
  }
  return Object.freeze({ name, uuid });
}

export function parsePositivePrice(raw: unknown, path: string, issues: IssueCollector): string | null {
  const lexeme = decimalLexeme(raw);
  if (lexeme === null) {
    issues.add(path, "invalid_price_type", "error", "price must retain an exact JSON numeric lexeme", raw);
    return null;
  }
  try {
    if (decimalAmount(lexeme).atoms <= 0n) {
      issues.add(path, "invalid_price", "error", "price must be positive", raw);
      return null;
    }
    return lexeme;
  } catch {
    issues.add(path, "invalid_price", "error", "price is not a valid exact decimal", raw);
    return null;
  }
}

export function validationState(issues: readonly ValidationIssue[]): RecordValidationState {
  if (issues.some((issue) => issue.severity === "error")) return "invalid";
  if (issues.some((issue) => issue.severity === "warning")) return "partial";
  return "valid";
}
