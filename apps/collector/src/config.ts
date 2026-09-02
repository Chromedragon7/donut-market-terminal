export type CollectorMode = "continuous" | "one_shot" | "validation";

export interface CollectorConfig {
  readonly databaseUrl: string;
  readonly apiBaseUrl: string;
  readonly apiBearerToken: string;
  readonly sourceKey: string;
  readonly sourceDisplayName: string;
  readonly instanceId: string;
  readonly mode: CollectorMode;
  readonly transactionPages: number;
  readonly transactionPollMs: number;
  readonly listingEnabled: boolean;
  readonly listingMaxPages: number;
  readonly listingScanBudgetMs: number;
  readonly listingPollMs: number;
  readonly requestsPerMinute: number;
  readonly transactionReservePercent: number;
  readonly maxRunBackoffMs: number;
  readonly healthPort: number;
  readonly leaseTtlMs: number;
  readonly shutdownGraceMs: number;
  readonly collectorVersion: string;
  readonly providerVersion: string;
  readonly validationVersion: string;
  readonly normalizationVersion: string;
  readonly dedupeVersion: string;
  readonly aggregationVersion: string;
  readonly scheduleVersion: string;
}

export function loadCollectorConfig(
  environment: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv.slice(2),
): CollectorConfig {
  const mode = argv.includes("--once")
    ? "one_shot"
    : parseEnum(environment.COLLECTOR_MODE, ["continuous", "one_shot", "validation"], "continuous");

  return Object.freeze({
    databaseUrl: requiredSecret(environment.DATABASE_URL, "DATABASE_URL"),
    apiBaseUrl: requiredUrl(environment.DONUT_API_BASE_URL, "DONUT_API_BASE_URL", environment.NODE_ENV),
    apiBearerToken: requiredSecret(environment.DONUT_API_KEY, "DONUT_API_KEY"),
    sourceKey: environment.DONUT_SOURCE_KEY?.trim() || "donut-compatible-mirror",
    sourceDisplayName: environment.DONUT_SOURCE_DISPLAY_NAME?.trim() || "Donut-compatible mirror",
    instanceId: environment.RAILWAY_REPLICA_ID?.trim()
      || environment.HOSTNAME?.trim()
      || `collector-${process.pid}`,
    mode,
    transactionPages: integer(environment.COLLECTOR_TRANSACTION_PAGES, 10, 1, 10),
    transactionPollMs: integer(environment.COLLECTOR_TRANSACTION_POLL_MS, 15_000, 1_000, 3_600_000),
    listingEnabled: booleanValue(environment.COLLECTOR_LISTING_ENABLED, false),
    listingMaxPages: integer(environment.COLLECTOR_LISTING_MAX_PAGES, 25, 1, 10_000),
    listingScanBudgetMs: integer(environment.COLLECTOR_LISTING_SCAN_BUDGET_MS, 10_000, 1_000, 300_000),
    listingPollMs: integer(environment.COLLECTOR_LISTING_POLL_MS, 60_000, 5_000, 3_600_000),
    requestsPerMinute: integer(environment.COLLECTOR_REQUESTS_PER_MINUTE, 200, 2, 250),
    transactionReservePercent: integer(
      environment.COLLECTOR_TRANSACTION_RESERVE_PERCENT,
      60,
      1,
      99,
    ),
    maxRunBackoffMs: integer(environment.COLLECTOR_MAX_RUN_BACKOFF_MS, 300_000, 1_000, 3_600_000),
    healthPort: integer(environment.PORT ?? environment.COLLECTOR_HEALTH_PORT, 3_001, 1, 65_535),
    leaseTtlMs: integer(environment.COLLECTOR_LEASE_TTL_MS, 60_000, 10_000, 600_000),
    shutdownGraceMs: integer(environment.COLLECTOR_SHUTDOWN_GRACE_MS, 20_000, 1_000, 120_000),
    collectorVersion: environment.COLLECTOR_VERSION?.trim() || "collector/v1",
    providerVersion: environment.DONUT_PROVIDER_VERSION?.trim() || "compatible-api/v1",
    validationVersion: environment.VALIDATION_VERSION?.trim() || "compatible-validation/v1",
    normalizationVersion: environment.NORMALIZATION_VERSION?.trim() || "item-variant/v1",
    dedupeVersion: environment.DEDUPE_VERSION?.trim() || "transaction-fingerprint/v1",
    aggregationVersion: environment.AGGREGATION_VERSION?.trim() || "market-aggregate/v1",
    scheduleVersion: environment.SCHEDULE_VERSION?.trim() || "priority-schedule/v1",
  });
}

export function publicCollectorConfig(config: CollectorConfig): Readonly<Record<string, unknown>> {
  return Object.freeze({
    sourceKey: config.sourceKey,
    mode: config.mode,
    transactionPages: config.transactionPages,
    transactionPollMs: config.transactionPollMs,
    listingEnabled: config.listingEnabled,
    listingMaxPages: config.listingMaxPages,
    listingScanBudgetMs: config.listingScanBudgetMs,
    listingPollMs: config.listingPollMs,
    requestsPerMinute: config.requestsPerMinute,
    transactionReservePercent: config.transactionReservePercent,
    collectorVersion: config.collectorVersion,
    providerVersion: config.providerVersion,
    validationVersion: config.validationVersion,
    normalizationVersion: config.normalizationVersion,
    dedupeVersion: config.dedupeVersion,
    aggregationVersion: config.aggregationVersion,
    scheduleVersion: config.scheduleVersion,
  });
}

function requiredSecret(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (normalized === undefined || normalized.length === 0) {
    throw new Error(`${name} is required and must be supplied through secret environment configuration`);
  }
  return normalized;
}

function requiredUrl(value: string | undefined, name: string, nodeEnvironment: string | undefined): string {
  const normalized = requiredSecret(value, name);
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  const allowInsecure = nodeEnvironment !== "production" && isLoopback(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && allowInsecure)) {
    throw new Error(`${name} must use HTTPS (HTTP is allowed only for a local non-production mock)`);
  }
  parsed.username = "";
  parsed.password = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function integer(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  if (!/^\d+$/.test(value.trim())) throw new Error(`Expected an integer, received ${value}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new RangeError(`Expected an integer from ${minimum} through ${maximum}`);
  }
  return parsed;
}

function booleanValue(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  if (/^(?:1|true|yes)$/i.test(value)) return true;
  if (/^(?:0|false|no)$/i.test(value)) return false;
  throw new Error(`Expected a boolean, received ${value}`);
}

function parseEnum<const T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (value === undefined || value.trim() === "") return fallback;
  if (allowed.includes(value as T)) return value as T;
  throw new Error(`Expected one of ${allowed.join(", ")}`);
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
