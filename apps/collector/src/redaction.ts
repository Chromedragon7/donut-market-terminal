const SENSITIVE_KEY = /(?:authorization|cookie|secret|token|api[-_]?key|password|database[_-]?url)/i;
const BEARER_VALUE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const URL_CREDENTIALS = /\b((?:postgres(?:ql)?|https?):\/\/)[^@\s/]+@/gi;

export function redact(
  value: unknown,
  seen = new WeakSet<object>(),
  secrets: readonly string[] = [],
): unknown {
  if (value instanceof Error) return safeError(value, secrets);
  if (value === null || typeof value !== "object") {
    return typeof value === "string" ? redactString(value, secrets) : value;
  }
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((entry) => redact(entry, seen, secrets));

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : redact(child, seen, secrets);
  }
  return result;
}

export function safeError(error: Error, secrets: readonly string[] = []): Readonly<Record<string, unknown>> {
  const serializable = typeof (error as Error & { toJSON?: unknown }).toJSON === "function"
    ? (error as Error & { toJSON(): unknown }).toJSON()
    : undefined;
  return Object.freeze({
    name: error.name,
    message: redactString(error.message, secrets),
    ...(serializable === undefined ? {} : { details: redact(serializable, new WeakSet<object>(), secrets) }),
  });
}

function redactString(value: string, secrets: readonly string[]): string {
  let result = value
    .replace(BEARER_VALUE, "Bearer [REDACTED]")
    .replace(URL_CREDENTIALS, "$1[REDACTED]@");
  for (const secret of secrets) {
    if (secret.length > 0) result = result.split(secret).join("[REDACTED]");
  }
  return result;
}

export function logEvent(
  level: "debug" | "info" | "warn" | "error",
  event: string,
  fields: Readonly<Record<string, unknown>> = {},
): void {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...redact(fields) as Record<string, unknown>,
  });
  (level === "error" ? process.stderr : process.stdout).write(`${line}\n`);
}
