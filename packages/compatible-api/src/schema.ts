import {
  assignTransactionOccurrenceOrdinals,
  calculateStackPricing,
  createListingObservationFingerprint,
  createTransactionFingerprint,
  normalizeItemVariant,
} from "@donut/domain";
import {
  integerValue,
  isObject,
  IssueCollector,
  parsePositivePrice,
  parseSeller,
  parseSourceItem,
  validationState,
  type UnknownRecord,
} from "./schema-fields.js";
import type {
  CompatibleListing,
  CompatibleTransaction,
  ListingPage,
  ParseEnvelopeContext,
  TransactionPage,
  ValidatedRecord,
  ValidationIssue,
} from "./types.js";

function bodyStatus(envelope: UnknownRecord, issues: IssueCollector): number | null {
  if (!Object.prototype.hasOwnProperty.call(envelope, "status")) {
    issues.add("$.status", "missing_body_status", "warning", "Response body did not include a status field");
    return null;
  }
  const status = integerValue(envelope.status);
  if (status === null || status < 0n || status > BigInt(Number.MAX_SAFE_INTEGER)) {
    issues.add("$.status", "invalid_body_status", "warning", "Body status must be a non-negative safe integer", envelope.status);
    return null;
  }
  return Number(status);
}

function emptyCounts<T>(records: readonly ValidatedRecord<T>[]): {
  readonly validCount: number;
  readonly partialCount: number;
  readonly invalidCount: number;
} {
  return Object.freeze({
    validCount: records.filter((record) => record.state === "valid").length,
    partialCount: records.filter((record) => record.state === "partial").length,
    invalidCount: records.filter((record) => record.state === "invalid").length,
  });
}

function envelope(
  input: unknown,
  issues: IssueCollector,
): { readonly value: UnknownRecord | null; readonly result: readonly unknown[] } {
  if (!isObject(input)) {
    issues.add("$", "invalid_envelope", "error", "Response must be a JSON object", input);
    return { value: null, result: Object.freeze([]) };
  }
  issues.unknownKeys(input, ["status", "result"], "$");
  if (!Array.isArray(input.result)) {
    issues.add("$.result", "invalid_result", "error", "Response result must be an array", input.result);
    return { value: input, result: Object.freeze([]) };
  }
  return { value: input, result: input.result };
}

function positiveTimestamp(
  raw: unknown,
  path: string,
  issues: IssueCollector,
): bigint | null {
  const timestamp = integerValue(raw);
  if (timestamp === null || timestamp <= 0n) {
    issues.add(path, "invalid_timestamp", "error", "Timestamp must be a positive integer number of Unix milliseconds", raw);
    return null;
  }
  return timestamp;
}

function parseTransactionRecord(
  raw: unknown,
  index: number,
  context: ParseEnvelopeContext,
): ValidatedRecord<CompatibleTransaction> {
  const issues = new IssueCollector();
  const path = `$.result[${index}]`;
  if (!isObject(raw)) {
    issues.add(path, "invalid_transaction", "error", "Transaction must be an object", raw);
    return Object.freeze({ index, state: "invalid", value: null, raw, issues: issues.snapshot() });
  }
  issues.unknownKeys(raw, ["item", "price", "seller", "unixMillisDateSold"], path);
  const sourceItem = parseSourceItem(raw.item, `${path}.item`, issues);
  const seller = parseSeller(raw.seller, `${path}.seller`, issues);
  const totalPriceLexeme = parsePositivePrice(raw.price, `${path}.price`, issues);
  const soldAtUnixMs = positiveTimestamp(raw.unixMillisDateSold, `${path}.unixMillisDateSold`, issues);

  let value: CompatibleTransaction | null = null;
  if (sourceItem !== null && sourceItem.count !== null && totalPriceLexeme !== null && soldAtUnixMs !== null) {
    const normalizedVariant = normalizeItemVariant(sourceItem);
    const stackPricing = calculateStackPricing(totalPriceLexeme, sourceItem.count);
    const fingerprint = createTransactionFingerprint({
      sourceId: context.sourceId,
      itemVariantFingerprint: normalizedVariant.fingerprint,
      sellerUuid: seller.uuid,
      sellerName: seller.name,
      totalPrice: totalPriceLexeme,
      quantity: sourceItem.count,
      soldAtUnixMs,
    });
    value = Object.freeze({
      sourceItem,
      seller,
      totalPriceLexeme,
      soldAtUnixMs,
      normalizedVariant,
      stackPricing,
      fingerprint,
      occurrenceOrdinal: 0,
      occurrenceKey: "",
      identicalOccurrenceCount: 0,
      collisionAmbiguous: false,
    });
  }
  const snapshot = issues.snapshot();
  return Object.freeze({ index, state: validationState(snapshot), value, raw, issues: snapshot });
}

function addTransactionOccurrences(
  records: readonly ValidatedRecord<CompatibleTransaction>[],
): readonly ValidatedRecord<CompatibleTransaction>[] {
  const values = records.flatMap((record) => record.value === null ? [] : [record.value]);
  const occurrences = assignTransactionOccurrenceOrdinals(values, (record) => record.fingerprint.value);
  const byValue = new Map(occurrences.map((occurrence) => [occurrence.record, occurrence]));
  return Object.freeze(records.map((record) => {
    if (record.value === null) return record;
    const occurrence = byValue.get(record.value)!;
    return Object.freeze({
      ...record,
      value: Object.freeze({
        ...record.value,
        occurrenceOrdinal: occurrence.occurrenceOrdinal,
        occurrenceKey: occurrence.occurrenceKey,
        identicalOccurrenceCount: occurrence.identicalOccurrenceCount,
        collisionAmbiguous: occurrence.collisionAmbiguous,
      }),
    });
  }));
}

export function parseTransactionEnvelope(input: unknown, context: ParseEnvelopeContext): TransactionPage {
  const issues = new IssueCollector();
  const parsedEnvelope = envelope(input, issues);
  const records = addTransactionOccurrences(parsedEnvelope.result.map((record, index) =>
    parseTransactionRecord(record, index, context),
  ));
  const counts = emptyCounts(records);
  return Object.freeze({
    kind: "transactions",
    page: context.page,
    httpBodyStatus: parsedEnvelope.value === null ? null : bodyStatus(parsedEnvelope.value, issues),
    records,
    issues: issues.snapshot(),
    ...counts,
  });
}

function optionalTimeLeft(raw: unknown, path: string, issues: IssueCollector): bigint | null {
  if (raw === undefined || raw === null) {
    issues.add(path, "missing_time_left", "warning", "Remaining listing time is unavailable", raw);
    return null;
  }
  const timeLeft = integerValue(raw);
  if (timeLeft === null || timeLeft < 0n) {
    issues.add(path, "invalid_time_left", "warning", "Remaining listing time must be a non-negative integer", raw);
    return null;
  }
  return timeLeft;
}

function parseListingRecord(
  raw: unknown,
  index: number,
  context: ParseEnvelopeContext,
): ValidatedRecord<CompatibleListing> {
  const issues = new IssueCollector();
  const path = `$.result[${index}]`;
  if (!isObject(raw)) {
    issues.add(path, "invalid_listing", "error", "Listing must be an object or a documented null padding slot", raw);
    return Object.freeze({ index, state: "invalid", value: null, raw, issues: issues.snapshot() });
  }
  issues.unknownKeys(raw, ["item", "price", "seller", "time_left"], path);
  const sourceItem = parseSourceItem(raw.item, `${path}.item`, issues);
  const seller = parseSeller(raw.seller, `${path}.seller`, issues);
  const totalPriceLexeme = parsePositivePrice(raw.price, `${path}.price`, issues);
  const timeLeftMs = optionalTimeLeft(raw.time_left, `${path}.time_left`, issues);

  let value: CompatibleListing | null = null;
  if (sourceItem !== null && sourceItem.count !== null && totalPriceLexeme !== null) {
    const normalizedVariant = normalizeItemVariant(sourceItem);
    const stackPricing = calculateStackPricing(totalPriceLexeme, sourceItem.count);
    const probabilisticFingerprint = createListingObservationFingerprint({
      sourceId: context.sourceId,
      itemVariantFingerprint: normalizedVariant.fingerprint,
      sellerUuid: seller.uuid,
      sellerName: seller.name,
      totalPrice: totalPriceLexeme,
      quantity: sourceItem.count,
      observedAtUnixMs: context.observedAtUnixMs,
      timeLeftMs,
    });
    value = Object.freeze({
      sourceItem,
      seller,
      totalPriceLexeme,
      timeLeftMs,
      normalizedVariant,
      stackPricing,
      probabilisticFingerprint,
    });
  }
  const snapshot = issues.snapshot();
  return Object.freeze({ index, state: validationState(snapshot), value, raw, issues: snapshot });
}

export function parseListingEnvelope(input: unknown, context: ParseEnvelopeContext): ListingPage {
  const issues = new IssueCollector();
  const parsedEnvelope = envelope(input, issues);
  const nullPaddingPositions: number[] = [];
  const records: ValidatedRecord<CompatibleListing>[] = [];
  parsedEnvelope.result.forEach((record, index) => {
    if (record === null) {
      nullPaddingPositions.push(index);
      return;
    }
    records.push(parseListingRecord(record, index, context));
  });
  const frozenRecords = Object.freeze(records);
  const counts = emptyCounts(frozenRecords);
  return Object.freeze({
    kind: "listings",
    page: context.page,
    httpBodyStatus: parsedEnvelope.value === null ? null : bodyStatus(parsedEnvelope.value, issues),
    records: frozenRecords,
    nullPaddingCount: nullPaddingPositions.length,
    nullPaddingPositions: Object.freeze(nullPaddingPositions),
    resultPositionCount: parsedEnvelope.result.length,
    issues: issues.snapshot(),
    ...counts,
  });
}

export function pageValidationIssues(page: TransactionPage | ListingPage): readonly ValidationIssue[] {
  return Object.freeze([
    ...page.issues,
    ...page.records.flatMap((record) => record.issues),
  ]);
}
