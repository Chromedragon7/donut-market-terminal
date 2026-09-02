import type { RawObservationEvidence } from "@donut/domain";

export type CompatibleApiErrorCode =
  | "aborted"
  | "configuration"
  | "forbidden"
  | "invalid_page"
  | "malformed_json"
  | "network"
  | "rate_limited"
  | "response_too_large"
  | "schema_validation"
  | "timeout"
  | "unauthorized"
  | "unknown"
  | "unsupported_endpoint"
  | "upstream_client"
  | "upstream_server";

export interface RedactionOptions {
  readonly secrets?: readonly string[];
  readonly maxDepth?: number;
}

const SENSITIVE_KEY = /(?:authorization|api[-_]?key|cookie|password|secret|session|token)/i;
const BEARER_VALUE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const URL_SECRET = /([?&](?:api[-_]?key|key|password|secret|token)=)[^&#\s]*/gi;

export function redactSensitive(value: unknown, options: RedactionOptions = {}): unknown {
  const secrets = (options.secrets ?? []).filter((entry) => entry.length > 0);
  const maxDepth = options.maxDepth ?? 12;
  const seen = new WeakSet<object>();

  function redactString(input: string): string {
    let result = input.replace(BEARER_VALUE, "Bearer [REDACTED]").replace(URL_SECRET, "$1[REDACTED]");
    for (const secret of secrets) result = result.split(secret).join("[REDACTED]");
    return result;
  }

  function visit(input: unknown, depth: number): unknown {
    if (typeof input === "string") return redactString(input);
    if (input === null || typeof input !== "object") return input;
    if (depth > maxDepth) return "[MAX_DEPTH]";
    if (seen.has(input)) return "[CIRCULAR]";
    seen.add(input);
    if (input instanceof Error) {
      return { name: input.name, message: redactString(input.message) };
    }
    if (Array.isArray(input)) return input.map((entry) => visit(entry, depth + 1));
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(input)) {
      result[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : visit(entry, depth + 1);
    }
    return result;
  }

  return visit(value, 0);
}

export interface CompatibleApiErrorOptions {
  readonly code: CompatibleApiErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly httpStatus?: number;
  readonly retryAfterMs?: number;
  readonly details?: unknown;
  /** Raw response evidence for persistence. Safe serialization deliberately omits its body. */
  readonly evidence?: RawObservationEvidence;
  readonly cause?: unknown;
  readonly secrets?: readonly string[];
}

export class CompatibleApiError extends Error {
  readonly code: CompatibleApiErrorCode;
  readonly retryable: boolean;
  readonly httpStatus?: number;
  readonly retryAfterMs?: number;
  readonly details?: unknown;
  readonly evidence?: RawObservationEvidence;

  constructor(options: CompatibleApiErrorOptions) {
    const safeMessage = String(redactSensitive(options.message, { secrets: options.secrets ?? [] }));
    super(safeMessage, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "CompatibleApiError";
    this.code = options.code;
    this.retryable = options.retryable;
    if (options.httpStatus !== undefined) this.httpStatus = options.httpStatus;
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs;
    if (options.details !== undefined) this.details = redactSensitive(options.details, { secrets: options.secrets ?? [] });
    if (options.evidence !== undefined) {
      Object.defineProperty(this, "evidence", {
        value: options.evidence,
        enumerable: false,
        configurable: false,
        writable: false,
      });
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return Object.freeze({
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.httpStatus === undefined ? {} : { httpStatus: this.httpStatus }),
      ...(this.retryAfterMs === undefined ? {} : { retryAfterMs: this.retryAfterMs }),
      ...(this.details === undefined ? {} : { details: this.details }),
      ...(this.evidence === undefined ? {} : {
        evidence: {
          sourceId: this.evidence.sourceId,
          endpoint: this.evidence.endpoint,
          observedAt: this.evidence.observedAt,
          httpStatus: this.evidence.httpStatus,
          byteLength: this.evidence.byteLength,
          contentSha256: this.evidence.contentSha256,
        },
      }),
    });
  }
}

export interface HttpErrorInput {
  readonly status: number;
  readonly bodySnippet: string;
  readonly retryAfterMs?: number;
  readonly evidence?: RawObservationEvidence;
  readonly secrets?: readonly string[];
}

export function httpResponseError(input: HttpErrorInput): CompatibleApiError {
  const common = {
    message: `Compatible API returned HTTP ${input.status}`,
    httpStatus: input.status,
    details: { bodySnippet: input.bodySnippet.slice(0, 512) },
    ...(input.retryAfterMs === undefined ? {} : { retryAfterMs: input.retryAfterMs }),
    ...(input.evidence === undefined ? {} : { evidence: input.evidence }),
    ...(input.secrets === undefined ? {} : { secrets: input.secrets }),
  };
  if (input.status === 401) return new CompatibleApiError({ ...common, code: "unauthorized", retryable: false });
  if (input.status === 403) return new CompatibleApiError({ ...common, code: "forbidden", retryable: false });
  if (input.status === 429) return new CompatibleApiError({ ...common, code: "rate_limited", retryable: true });
  if (input.status === 500 && /page you entered does not exist/i.test(input.bodySnippet)) {
    return new CompatibleApiError({ ...common, code: "invalid_page", retryable: false });
  }
  if (input.status >= 500) return new CompatibleApiError({ ...common, code: "upstream_server", retryable: true });
  if (input.status >= 400) return new CompatibleApiError({ ...common, code: "upstream_client", retryable: false });
  return new CompatibleApiError({ ...common, code: "unknown", retryable: false });
}

export function asCompatibleApiError(error: unknown, secrets: readonly string[] = []): CompatibleApiError {
  if (error instanceof CompatibleApiError) return error;
  if (error instanceof DOMException && error.name === "AbortError") {
    return new CompatibleApiError({ code: "aborted", message: error.message, retryable: false, cause: error, secrets });
  }
  if (error instanceof Error) {
    return new CompatibleApiError({ code: "network", message: error.message, retryable: true, cause: error, secrets });
  }
  return new CompatibleApiError({ code: "unknown", message: "Unknown compatible API failure", retryable: false, details: error, secrets });
}
