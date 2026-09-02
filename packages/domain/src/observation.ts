import { sha256Hex } from "./json.js";

export type ValidationState = "invalid" | "partial" | "valid";
export type NormalizationState = "failed" | "not_attempted" | "normalized" | "partial";
export type ConfidenceLabel = "high" | "low" | "medium" | "unavailable";

export interface RawObservationEvidence {
  readonly sourceId: string;
  readonly providerVersion: string;
  readonly collectorVersion: string;
  readonly endpoint: string;
  readonly observedAt: string;
  readonly sourceTimestamp?: string;
  readonly httpStatus: number;
  readonly contentType?: string;
  readonly responseHeaders: Readonly<Record<string, string>>;
  /** Exact upstream response text. Store append-only. */
  readonly rawBody: string;
  readonly byteLength: number;
  readonly contentSha256: string;
  readonly validationState: ValidationState;
  readonly normalizationState: NormalizationState;
  readonly confidence: ConfidenceLabel;
}

export interface CreateRawObservationEvidenceInput
  extends Omit<RawObservationEvidence, "byteLength" | "contentSha256" | "observedAt" | "responseHeaders"> {
  readonly observedAt: Date | string;
  readonly responseHeaders?: Readonly<Record<string, string | readonly string[] | undefined>>;
}

const SENSITIVE_HEADER = /(?:^|[-_])(?:authorization|cookie|password|secret|session|token|api[-_]?key)(?:$|[-_])/i;

function sanitizeHeaders(
  headers: Readonly<Record<string, string | readonly string[] | undefined>> | undefined,
): Readonly<Record<string, string>> {
  const sanitized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (value === undefined || SENSITIVE_HEADER.test(name)) continue;
    sanitized[name.toLowerCase()] = typeof value === "string" ? value : value.join(", ");
  }
  return Object.freeze(sanitized);
}

export function createRawObservationEvidence(input: CreateRawObservationEvidenceInput): RawObservationEvidence {
  const date = input.observedAt instanceof Date ? input.observedAt : new Date(input.observedAt);
  if (Number.isNaN(date.valueOf())) throw new TypeError("observedAt must be a valid date");
  return Object.freeze({
    sourceId: input.sourceId,
    providerVersion: input.providerVersion,
    collectorVersion: input.collectorVersion,
    endpoint: input.endpoint,
    observedAt: date.toISOString(),
    ...(input.sourceTimestamp === undefined ? {} : { sourceTimestamp: input.sourceTimestamp }),
    httpStatus: input.httpStatus,
    ...(input.contentType === undefined ? {} : { contentType: input.contentType }),
    responseHeaders: sanitizeHeaders(input.responseHeaders),
    rawBody: input.rawBody,
    byteLength: Buffer.byteLength(input.rawBody, "utf8"),
    contentSha256: sha256Hex(input.rawBody),
    validationState: input.validationState,
    normalizationState: input.normalizationState,
    confidence: input.confidence,
  });
}
