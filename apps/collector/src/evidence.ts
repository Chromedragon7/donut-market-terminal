import { randomUUID } from "node:crypto";
import type { CompatibleApiError, CompatiblePageResult } from "@donut/compatible-api";
import type { JsonObject, RawPayloadInput, SourceRequestInput } from "@donut/db";
import type { RawObservationEvidence } from "@donut/domain";
import type { CollectorStore } from "./types.js";

export interface PersistEvidenceContext {
  readonly runId: string;
  readonly sourceId: string;
  readonly resource: "auction_transactions" | "auction_listings";
  readonly page: number;
  readonly providerVersion: string;
}

export interface PersistedPage<T> {
  readonly requestId: string;
  readonly result: CompatiblePageResult<T>;
  readonly observedAt: Date;
}

export async function persistPageEvidence<T>(
  store: CollectorStore,
  context: PersistEvidenceContext,
  result: CompatiblePageResult<T>,
  completenessStatus: "unknown" | "complete" | "partial" | "empty",
): Promise<PersistedPage<T>> {
  const requestId = randomUUID();
  const observedAt = safeDate(result.evidence.observedAt);
  const requestedAt = new Date(Math.max(0, observedAt.valueOf() - Math.max(0, result.latencyMs)));
  await store.appendFetchEvidence(rawPayload(result.evidence), {
    id: requestId,
    runId: context.runId,
    sourceId: context.sourceId,
    resource: context.resource,
    page: context.page,
    attempt: Math.max(1, result.attempts),
    requestedAt,
    respondedAt: observedAt,
    latencyMs: Math.max(0, Math.round(result.latencyMs)),
    httpStatus: result.evidence.httpStatus,
    requestMetadata: { endpoint: result.endpoint },
    responsePayloadSha256: result.evidence.contentSha256,
    responseBytes: result.evidence.byteLength,
    validationStatus: validationStatus(result.evidence),
    completenessStatus,
    rateLimitMetadata: rateLimitMetadata(result.evidence.responseHeaders),
    providerVersion: context.providerVersion,
  });
  return { requestId, result, observedAt };
}

export async function persistErrorEvidence(
  store: CollectorStore,
  context: PersistEvidenceContext,
  error: CompatibleApiError,
  attempt: number,
  requestedAt: Date,
): Promise<string> {
  const requestId = randomUUID();
  const evidence = error.evidence;
  const observedAt = evidence === undefined ? new Date() : safeDate(evidence.observedAt);
  const input: SourceRequestInput = {
    id: requestId,
    runId: context.runId,
    sourceId: context.sourceId,
    resource: context.resource,
    page: context.page,
    attempt: Math.max(1, attempt),
    requestedAt,
    respondedAt: observedAt,
    latencyMs: Math.max(0, observedAt.valueOf() - requestedAt.valueOf()),
    ...(error.httpStatus === undefined ? {} : { httpStatus: error.httpStatus }),
    requestMetadata: { endpoint: evidence?.endpoint ?? "unknown" },
    ...(evidence === undefined ? {} : {
      responsePayloadSha256: evidence.contentSha256,
      responseBytes: evidence.byteLength,
    }),
    validationStatus: evidence === undefined ? "not_attempted" : validationStatus(evidence),
    completenessStatus: "partial",
    errorCode: error.code,
    errorMessage: error.message,
    rateLimitMetadata: rateLimitMetadata(evidence?.responseHeaders ?? {}),
    providerVersion: context.providerVersion,
  };
  await store.appendFetchEvidence(evidence === undefined ? undefined : rawPayload(evidence), input);
  return requestId;
}

function rawPayload(evidence: RawObservationEvidence): RawPayloadInput {
  return {
    sha256: evidence.contentSha256,
    bytes: new TextEncoder().encode(evidence.rawBody),
    ...(evidence.contentType === undefined ? {} : { contentType: evidence.contentType }),
    firstObservedAt: safeDate(evidence.observedAt),
  };
}

function validationStatus(
  evidence: RawObservationEvidence,
): SourceRequestInput["validationStatus"] {
  if (evidence.validationState === "valid") return "valid";
  if (evidence.validationState === "partial") return "partially_valid";
  return "invalid";
}

function rateLimitMetadata(headers: Readonly<Record<string, string>>): JsonObject {
  const safe: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (/^(?:retry-after|ratelimit-|x-ratelimit-)/i.test(name)) safe[name.toLowerCase()] = value;
  }
  return safe;
}

function safeDate(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new TypeError("Provider evidence contained an invalid timestamp");
  return date;
}
