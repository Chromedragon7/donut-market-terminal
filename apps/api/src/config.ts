export interface ApiConfig {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  allowedOrigins: string[];
  cookieSecure: boolean;
  sessionTtlMs: number;
  tokenHashSecret: string;
  sellerPseudonymSecret: string;
  metricsBearerToken: string | null;
  ownerUsername: string;
  ownerPasswordHash: string;
  exposeOpenApi: boolean;
  requestBodyLimitBytes: number;
  globalRateLimitPerMinute: number;
  loginRateLimitPerMinute: number;
}

function readInteger(value: string | undefined, fallback: number, name: string, minimum: number, maximum: number): number {
  if (value === undefined || value.length === 0) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

function strongSecret(value: string | undefined, name: string, production: boolean): string {
  if (!production && (value === undefined || value.length === 0)) {
    return `development-only-${name.toLowerCase()}-replace-before-production`;
  }
  const secret = required(value, name);
  if (secret.length < 32) throw new Error(`${name} must contain at least 32 characters`);
  return secret;
}

export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const rawNodeEnv = env.NODE_ENV ?? "development";
  if (rawNodeEnv !== "development" && rawNodeEnv !== "test" && rawNodeEnv !== "production") {
    throw new Error("NODE_ENV must be development, test, or production");
  }
  const production = rawNodeEnv === "production";
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? env.PUBLIC_APP_ORIGIN ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter((origin) => origin.length > 0);
  if (allowedOrigins.length === 0 || allowedOrigins.some((origin) => origin === "*")) {
    throw new Error("ALLOWED_ORIGINS must contain explicit origins; wildcard origins are forbidden");
  }
  const metricsToken = production
    ? strongSecret(env.METRICS_BEARER_TOKEN, "METRICS_BEARER_TOKEN", true)
    : (env.METRICS_BEARER_TOKEN ?? null);
  return {
    nodeEnv: rawNodeEnv,
    host: env.API_HOST ?? env.HOST ?? "0.0.0.0",
    port: readInteger(env.PORT ?? env.API_PORT, 3001, "PORT", 1, 65_535),
    allowedOrigins,
    cookieSecure: production || env.COOKIE_SECURE === "true",
    sessionTtlMs: readInteger(env.SESSION_TTL_SECONDS, 604_800, "SESSION_TTL_SECONDS", 300, 2_592_000) * 1000,
    tokenHashSecret: strongSecret(env.TOKEN_HASH_SECRET ?? env.SESSION_SECRET, "TOKEN_HASH_SECRET", production),
    sellerPseudonymSecret: strongSecret(env.SELLER_PSEUDONYM_SECRET, "SELLER_PSEUDONYM_SECRET", production),
    metricsBearerToken: metricsToken,
    ownerUsername: required(env.OWNER_USERNAME ?? env.OWNER_EMAIL, "OWNER_USERNAME",),
    ownerPasswordHash: required(env.OWNER_PASSWORD_HASH, "OWNER_PASSWORD_HASH"),
    exposeOpenApi: env.EXPOSE_OPENAPI === "true" || (!production && env.EXPOSE_OPENAPI !== "false"),
    requestBodyLimitBytes: readInteger(env.REQUEST_BODY_LIMIT_BYTES, 65_536, "REQUEST_BODY_LIMIT_BYTES", 4096, 1_048_576),
    globalRateLimitPerMinute: readInteger(env.API_RATE_LIMIT_PER_MINUTE, 120, "API_RATE_LIMIT_PER_MINUTE", 10, 10_000),
    loginRateLimitPerMinute: readInteger(env.LOGIN_RATE_LIMIT_PER_MINUTE, 5, "LOGIN_RATE_LIMIT_PER_MINUTE", 1, 100),
  };
}
