import { createCompatibleApiClient } from "@donut/compatible-api";
import { createDatabasePool, MarketRepository, runMigrations } from "@donut/db";
import { loadCollectorConfig, publicCollectorConfig } from "./config.js";
import { startHealthServer, stopHealthServer, initialRuntimeState } from "./health.js";
import { MarketCollector } from "./ingestion.js";
import { CollectorMetrics } from "./metrics.js";
import { PriorityRateBudget } from "./rate-budget.js";
import { logEvent, safeError } from "./redaction.js";
import { CollectorScheduler } from "./scheduler.js";

async function main(): Promise<void> {
  const config = loadCollectorConfig();
  const metrics = new CollectorMetrics();
  const state = initialRuntimeState();
  const shutdown = new AbortController();
  const pool = createDatabasePool({
    connectionString: config.databaseUrl,
    applicationName: `donut-collector:${config.instanceId}`,
    maxConnections: 8,
    ...(process.env.PGSSLMODE?.toLowerCase() === "require" ? { ssl: "require" as const } : {}),
  });
  const repository = new MarketRepository(pool);
  let healthServer: Awaited<ReturnType<typeof startHealthServer>> | undefined;
  let forcedShutdownTimer: NodeJS.Timeout | undefined;

  const requestShutdown = (signal: string): void => {
    if (shutdown.signal.aborted) return;
    state.shuttingDown = true;
    logEvent("info", "collector_shutdown_requested", { signal });
    shutdown.abort(new Error(`Shutdown requested by ${signal}`));
    forcedShutdownTimer = setTimeout(() => {
      logEvent("error", "collector_shutdown_grace_exceeded", {
        shutdownGraceMs: config.shutdownGraceMs,
      });
      process.exit(1);
    }, config.shutdownGraceMs);
    forcedShutdownTimer.unref();
  };
  process.once("SIGINT", () => requestShutdown("SIGINT"));
  process.once("SIGTERM", () => requestShutdown("SIGTERM"));

  try {
    healthServer = await startHealthServer(config.healthPort, state, metrics);
    logEvent("info", "collector_starting", {
      port: config.healthPort,
      configuration: publicCollectorConfig(config),
    });

    const migrationResult = await runMigrations(pool);
    state.databaseReady = await repository.ping();
    logEvent("info", "collector_database_ready", {
      appliedMigrations: migrationResult.applied,
      existingMigrationCount: migrationResult.alreadyApplied.length,
    });

    const endpoint = new URL(config.apiBaseUrl);
    const sourceId = await repository.upsertSource({
      key: config.sourceKey,
      type: "compatible_auction_api",
      displayName: config.sourceDisplayName,
      endpointMetadata: {
        protocol: endpoint.protocol,
        hostname: endpoint.hostname,
        pathname: endpoint.pathname,
      },
      enabled: true,
      trustLevel: "compatible",
    });

    const providerBurstCapacity = Math.min(10, config.requestsPerMinute);
    const api = createCompatibleApiClient({
      baseUrl: config.apiBaseUrl,
      bearerToken: config.apiBearerToken,
      allowedHosts: [endpoint.hostname],
      sourceId,
      collectorVersion: config.collectorVersion,
      providerVersion: config.providerVersion,
      rateBudgetConfig: {
        requestsPerMinute: config.requestsPerMinute,
        burstCapacity: providerBurstCapacity,
        reservedTransactionCapacity: Math.max(
          1,
          Math.floor(providerBurstCapacity * config.transactionReservePercent / 100),
        ),
      },
      retryPolicy: {
        maxAttempts: 4,
        baseDelayMs: 250,
        maxDelayMs: 8_000,
        maxRetryAfterMs: config.maxRunBackoffMs,
      },
    });
    const budget = new PriorityRateBudget({
      requestsPerMinute: config.requestsPerMinute,
      transactionReservePercent: config.transactionReservePercent,
    });
    const collector = new MarketCollector(
      api,
      repository,
      sourceId,
      config,
      budget,
      metrics,
      { onAuthorization: (authorized) => { state.upstreamAuthorized = authorized; } },
    );
    const scheduler = new CollectorScheduler(collector, repository, sourceId, config, {
      onLeader: (leader) => {
        state.leader = leader;
        state.running = leader;
      },
      onRun: (outcome) => {
        state.lastError = outcome.status === "succeeded" ? null : `run_${outcome.status}`;
        logEvent(outcome.status === "succeeded" ? "info" : "warn", "collection_run_complete", {
          resource: outcome.resource,
          runId: outcome.runId,
          status: outcome.status,
          durationMs: outcome.completedAt.valueOf() - outcome.startedAt.valueOf(),
          counts: outcome.counts,
        });
      },
    });

    await scheduler.run(shutdown.signal);
  } catch (error) {
    if (!shutdown.signal.aborted) {
      state.lastError = error instanceof Error ? error.name : "unknown";
      logEvent("error", "collector_fatal", {
        error: safeError(
          error instanceof Error ? error : new Error("Unknown failure"),
          [config.apiBearerToken, config.databaseUrl],
        ),
      });
      process.exitCode = 1;
    }
  } finally {
    if (forcedShutdownTimer !== undefined) clearTimeout(forcedShutdownTimer);
    state.running = false;
    state.shuttingDown = true;
    if (healthServer !== undefined) {
      await stopHealthServer(healthServer).catch((error: unknown) => {
        logEvent("error", "health_server_stop_failed", {
          error: safeError(error instanceof Error ? error : new Error("Unknown health server stop failure")),
        });
      });
    }
    await repository.close().catch((error: unknown) => {
      logEvent("error", "database_pool_close_failed", {
        error: safeError(error instanceof Error ? error : new Error("Unknown database close failure")),
      });
    });
    logEvent("info", "collector_stopped");
  }
}

await main();
