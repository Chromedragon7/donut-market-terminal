export type UpstreamErrorKind =
  | "unauthorized"
  | "rate_limited"
  | "timeout"
  | "upstream_invalid"
  | "validation_failed"
  | "transient_server_error"
  | "not_found";

export class UpstreamError extends Error {
  readonly kind: UpstreamErrorKind;
  readonly statusCode?: number;
  readonly retryAfterMs?: number;

  constructor(
    kind: UpstreamErrorKind,
    message: string,
    opts: { statusCode?: number; retryAfterMs?: number } = {},
  ) {
    super(message);
    this.name = "UpstreamError";
    this.kind = kind;
    this.statusCode = opts.statusCode;
    this.retryAfterMs = opts.retryAfterMs;
  }
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof UpstreamError) {
    return (
      err.kind === "rate_limited" ||
      err.kind === "timeout" ||
      err.kind === "transient_server_error"
    );
  }
  return false;
}
