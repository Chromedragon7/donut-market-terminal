import { performance } from "node:perf_hooks";
import {
  createRawObservationEvidence,
  type ConfidenceLabel,
  type NormalizationState,
  type RawObservationEvidence,
  type ValidationState,
} from "@donut/domain";
import { CompatibleApiError, httpResponseError } from "./errors.js";
import { LosslessJsonParseError, parseLosslessJson } from "./lossless-json.js";
import { TokenBucketRateBudget, type RateBudgetConfig, type RequestClass } from "./rate-budget.js";
import { executeWithRetry, parseRetryAfter, type RetryEvent, type RetryPolicy } from "./retry.js";
import { pageValidationIssues, parseListingEnvelope, parseTransactionEnvelope } from "./schema.js";
import {
  CompatibleApiTransport,
  type AuctionListRequest,
  type CompatibleApiTransportConfig,
  type HttpDispatcher,
  type TransportResponse,
} from "./transport.js";
import type { ListingPage, TransactionPage } from "./types.js";

export interface CompatiblePageResult<T> {
  readonly page: number;
  readonly endpoint: string;
  readonly data: T;
  readonly evidence: RawObservationEvidence;
  readonly attempts: number;
  /** Total wall-clock time including local budget waits and upstream retries. */
  readonly latencyMs: number;
}

export interface CompatibleRequestOptions {
  readonly signal?: AbortSignal;
  readonly onRetry?: (event: RetryEvent) => void | Promise<void>;
}

export interface CompatibleListingRequestOptions extends CompatibleRequestOptions {
  readonly requestClass?: Exclude<RequestClass, "transactions">;
}

export interface CompatibleApiClient {
  getTransactionPage(
    page: number,
    options?: CompatibleRequestOptions,
  ): Promise<CompatiblePageResult<TransactionPage>>;
  getListingPage(
    page: number,
    request?: AuctionListRequest,
    options?: CompatibleListingRequestOptions,
  ): Promise<CompatiblePageResult<ListingPage>>;
}

export interface CompatibleApiClientConfig {
  readonly bearerToken: string;
  readonly baseUrl?: string;
  readonly allowedHosts?: readonly string[];
  readonly sourceId?: string;
  readonly providerVersion?: string;
  readonly collectorVersion?: string;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly userAgent?: string;
  readonly dispatcher?: HttpDispatcher;
  readonly transport?: CompatibleApiTransport;
  readonly rateBudget?: TokenBucketRateBudget;
  readonly rateBudgetConfig?: Partial<RateBudgetConfig>;
  readonly retryPolicy?: Partial<RetryPolicy>;
  readonly now?: () => number;
}

interface EvidenceContext {
  readonly endpoint: string;
  readonly observedAtUnixMs: number;
  readonly response: TransportResponse;
  readonly validationState: ValidationState;
  readonly normalizationState: NormalizationState;
  readonly confidence: ConfidenceLabel;
}

interface SuccessfulAttempt<T> {
  readonly data: T;
  readonly evidence: RawObservationEvidence;
}

function nonEmpty(value: string | undefined, fallback: string, name: string): string {
  const result = value?.trim() || fallback;
  if (/[\r\n]/.test(result)) throw new TypeError(name + " cannot contain line breaks");
  return result;
}

function pageStates(page: ListingPage | TransactionPage): {
  readonly validationState: ValidationState;
  readonly normalizationState: NormalizationState;
  readonly confidence: ConfidenceLabel;
} {
  const issues = pageValidationIssues(page);
  const hasError = issues.some((issue) => issue.severity === "error");
  const hasWarning = issues.some((issue) => issue.severity === "warning");
  const validationState: ValidationState = hasError ? "invalid" : hasWarning ? "partial" : "valid";
  const normalizedCount = page.records.filter((record) => record.value !== null).length;
  const normalizationState: NormalizationState = normalizedCount === 0 && hasError
    ? "failed"
    : hasError || hasWarning
      ? "partial"
      : "normalized";
  const confidence: ConfidenceLabel = normalizedCount === 0
    ? "unavailable"
    : hasError
      ? "low"
      : hasWarning
        ? "medium"
        : "high";
  return Object.freeze({ validationState, normalizationState, confidence });
}

function safeNow(clock: () => number): number {
  const value = clock();
  if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000) {
    throw new TypeError("Compatible API clock must return non-negative, Date-compatible Unix milliseconds");
  }
  return value;
}

class DefaultCompatibleApiClient implements CompatibleApiClient {
  private readonly transport: CompatibleApiTransport;
  private readonly rateBudget: TokenBucketRateBudget;
  private readonly retryPolicy: RetryPolicy;
  private readonly token: string;
  private readonly sourceId: string;
  private readonly providerVersion: string;
  private readonly collectorVersion: string;
  private readonly now: () => number;

  constructor(config: CompatibleApiClientConfig) {
    const token = config.bearerToken.trim();
    if (token.length === 0 || /[\r\n]/.test(token)) {
      throw new CompatibleApiError({ code: "configuration", message: "Compatible API bearer token is missing or invalid", retryable: false });
    }
    this.token = token;
    const transportConfig: CompatibleApiTransportConfig = {
      baseUrl: config.baseUrl ?? "https://api.donutsmp.net",
      bearerToken: token,
      ...(config.allowedHosts === undefined ? {} : { allowedHosts: config.allowedHosts }),
      ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
      ...(config.maxResponseBytes === undefined ? {} : { maxResponseBytes: config.maxResponseBytes }),
      ...(config.userAgent === undefined ? {} : { userAgent: config.userAgent }),
      ...(config.dispatcher === undefined ? {} : { dispatcher: config.dispatcher }),
    };
    this.transport = config.transport ?? new CompatibleApiTransport(transportConfig);
    const budgetConfig = config.rateBudgetConfig ?? {};
    this.rateBudget = config.rateBudget ?? new TokenBucketRateBudget({
      requestsPerMinute: budgetConfig.requestsPerMinute ?? 250,
      burstCapacity: budgetConfig.burstCapacity ?? 250,
      reservedTransactionCapacity: budgetConfig.reservedTransactionCapacity ?? 50,
      initialTokens: budgetConfig.initialTokens ?? "full",
      ...(budgetConfig.now === undefined ? {} : { now: budgetConfig.now }),
      ...(budgetConfig.sleep === undefined ? {} : { sleep: budgetConfig.sleep }),
    });
    const retry = config.retryPolicy ?? {};
    this.retryPolicy = Object.freeze({
      maxAttempts: retry.maxAttempts ?? 4,
      baseDelayMs: retry.baseDelayMs ?? 250,
      maxDelayMs: retry.maxDelayMs ?? 8_000,
      maxRetryAfterMs: retry.maxRetryAfterMs ?? 15 * 60_000,
      ...(retry.random === undefined ? {} : { random: retry.random }),
      ...(retry.sleep === undefined ? {} : { sleep: retry.sleep }),
    });
    this.sourceId = nonEmpty(config.sourceId, "donutsmp-compatible-api", "sourceId");
    this.providerVersion = nonEmpty(config.providerVersion, "openapi-v1.0", "providerVersion");
    this.collectorVersion = nonEmpty(config.collectorVersion, "0.1.0", "collectorVersion");
    this.now = config.now ?? Date.now;
  }

  private evidence(context: EvidenceContext): RawObservationEvidence {
    return createRawObservationEvidence({
      sourceId: this.sourceId,
      providerVersion: this.providerVersion,
      collectorVersion: this.collectorVersion,
      endpoint: context.endpoint,
      observedAt: new Date(context.observedAtUnixMs),
      httpStatus: context.response.status,
      ...(context.response.headers["content-type"] === undefined
        ? {}
        : { contentType: context.response.headers["content-type"] }),
      responseHeaders: context.response.headers,
      rawBody: context.response.rawBody,
      validationState: context.validationState,
      normalizationState: context.normalizationState,
      confidence: context.confidence,
    });
  }

  private responseError(response: TransportResponse, endpoint: string, observedAtUnixMs: number): CompatibleApiError {
    const evidence = this.evidence({
      endpoint,
      observedAtUnixMs,
      response,
      validationState: "invalid",
      normalizationState: "not_attempted",
      confidence: "unavailable",
    });
    const retryAfterMs = parseRetryAfter(response.headers["retry-after"], observedAtUnixMs);
    return httpResponseError({
      status: response.status,
      bodySnippet: response.rawBody,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      evidence,
      secrets: [this.token],
    });
  }

  private parseResponse<T extends ListingPage | TransactionPage>(
    response: TransportResponse,
    endpoint: string,
    observedAtUnixMs: number,
    parse: (input: unknown) => T,
  ): SuccessfulAttempt<T> {
    if (response.status < 200 || response.status >= 300) {
      throw this.responseError(response, endpoint, observedAtUnixMs);
    }
    let decoded: unknown;
    try {
      decoded = parseLosslessJson(response.rawBody);
    } catch (cause) {
      const evidence = this.evidence({
        endpoint,
        observedAtUnixMs,
        response,
        validationState: "invalid",
        normalizationState: "not_attempted",
        confidence: "unavailable",
      });
      throw new CompatibleApiError({
        code: "malformed_json",
        message: cause instanceof LosslessJsonParseError ? cause.message : "Compatible API returned malformed JSON",
        retryable: true,
        httpStatus: response.status,
        evidence,
        cause,
        secrets: [this.token],
      });
    }

    let data: T;
    try {
      data = parse(decoded);
    } catch (cause) {
      const evidence = this.evidence({
        endpoint,
        observedAtUnixMs,
        response,
        validationState: "invalid",
        normalizationState: "failed",
        confidence: "unavailable",
      });
      throw new CompatibleApiError({
        code: "schema_validation",
        message: "Compatible API response could not be normalized",
        retryable: false,
        httpStatus: response.status,
        evidence,
        cause,
        secrets: [this.token],
      });
    }

    const states = pageStates(data);
    const evidence = this.evidence({ endpoint, observedAtUnixMs, response, ...states });
    if (data.issues.some((issue) => issue.severity === "error")) {
      throw new CompatibleApiError({
        code: "schema_validation",
        message: "Compatible API response envelope failed validation",
        retryable: false,
        httpStatus: response.status,
        details: { issues: data.issues },
        evidence,
        secrets: [this.token],
      });
    }
    return Object.freeze({ data, evidence });
  }

  private async run<T extends ListingPage | TransactionPage>(
    page: number,
    endpoint: string,
    requestClass: RequestClass,
    request: (signal: AbortSignal | undefined) => Promise<TransportResponse>,
    parse: (input: unknown, observedAtUnixMs: number) => T,
    options: CompatibleRequestOptions,
  ): Promise<CompatiblePageResult<T>> {
    const started = performance.now();
    const result = await executeWithRetry(async () => {
      await this.rateBudget.acquire(requestClass, options.signal === undefined ? {} : { signal: options.signal });
      const response = await request(options.signal);
      const observedAtUnixMs = safeNow(this.now);
      return this.parseResponse(response, endpoint, observedAtUnixMs, (input) => parse(input, observedAtUnixMs));
    }, this.retryPolicy, {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.onRetry === undefined ? {} : { onRetry: options.onRetry }),
      secrets: [this.token],
    });
    return Object.freeze({
      page,
      endpoint,
      data: result.value.data,
      evidence: result.value.evidence,
      attempts: result.attempts,
      latencyMs: performance.now() - started,
    });
  }

  getTransactionPage(
    page: number,
    options: CompatibleRequestOptions = {},
  ): Promise<CompatiblePageResult<TransactionPage>> {
    const endpoint = "/v1/auction/transactions/" + page;
    return this.run(
      page,
      endpoint,
      "transactions",
      (signal) => this.transport.requestTransactionPage(page, signal),
      (input, observedAtUnixMs) => parseTransactionEnvelope(input, {
        sourceId: this.sourceId,
        page,
        observedAtUnixMs,
      }),
      options,
    );
  }

  getListingPage(
    page: number,
    request: AuctionListRequest = {},
    options: CompatibleListingRequestOptions = {},
  ): Promise<CompatiblePageResult<ListingPage>> {
    const endpoint = "/v1/auction/list/" + page;
    return this.run(
      page,
      endpoint,
      options.requestClass ?? "watched_listings",
      (signal) => this.transport.requestListingPage(page, request, signal),
      (input, observedAtUnixMs) => parseListingEnvelope(input, {
        sourceId: this.sourceId,
        page,
        observedAtUnixMs,
      }),
      options,
    );
  }
}

export function createCompatibleApiClient(config: CompatibleApiClientConfig): CompatibleApiClient {
  return new DefaultCompatibleApiClient(config);
}
