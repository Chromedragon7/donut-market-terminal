import { createServer, type Server } from "node:http";
import type { CollectorMetrics } from "./metrics.js";

export interface CollectorRuntimeState {
  running: boolean;
  shuttingDown: boolean;
  databaseReady: boolean;
  leader: boolean;
  upstreamAuthorized: boolean | null;
  lastError: string | null;
}

export function initialRuntimeState(): CollectorRuntimeState {
  return {
    running: false,
    shuttingDown: false,
    databaseReady: false,
    leader: false,
    upstreamAuthorized: null,
    lastError: null,
  };
}

export async function startHealthServer(
  port: number,
  state: CollectorRuntimeState,
  metrics: CollectorMetrics,
): Promise<Server> {
  const server = createServer((request, response) => {
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");

    if (request.url === "/health/live") {
      const live = !state.shuttingDown;
      respondJson(response, live ? 200 : 503, { status: live ? "live" : "stopping" });
      return;
    }
    if (request.url === "/health/ready") {
      const ready = state.running
        && state.databaseReady
        && state.leader
        && state.upstreamAuthorized !== false
        && !state.shuttingDown;
      respondJson(response, ready ? 200 : 503, {
        status: ready ? "ready" : "not_ready",
        databaseReady: state.databaseReady,
        leader: state.leader,
        upstreamAuthorized: state.upstreamAuthorized,
      });
      return;
    }
    if (request.url === "/metrics") {
      const snapshot = metrics.snapshot();
      response.statusCode = 200;
      response.setHeader("content-type", "text/plain; version=0.0.4; charset=utf-8");
      response.end(prometheus(snapshot));
      return;
    }
    respondJson(response, 404, { error: "not_found" });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}

export async function stopHealthServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error));
    server.closeIdleConnections?.();
  });
}

function respondJson(
  response: import("node:http").ServerResponse,
  status: number,
  body: Readonly<Record<string, unknown>>,
): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(body)}\n`);
}

function prometheus(snapshot: ReturnType<CollectorMetrics["snapshot"]>): string {
  const counters: Array<[string, number]> = [
    ["donut_collector_requests_total", snapshot.requests],
    ["donut_collector_responses_total", snapshot.responses],
    ["donut_collector_records_received_total", snapshot.receivedRecords],
    ["donut_collector_records_new_total", snapshot.newRecords],
    ["donut_collector_records_duplicate_total", snapshot.duplicateRecords],
    ["donut_collector_records_invalid_total", snapshot.invalidRecords],
    ["donut_collector_throttles_total", snapshot.throttles],
    ["donut_collector_authentication_failures_total", snapshot.authenticationFailures],
    ["donut_collector_upstream_failures_total", snapshot.upstreamFailures],
    ["donut_collector_database_failures_total", snapshot.databaseFailures],
    ["donut_collector_runs_transactions_total", snapshot.transactionRuns],
    ["donut_collector_runs_listings_total", snapshot.listingRuns],
    ["donut_collector_runs_partial_total", snapshot.partialRuns],
    ["donut_collector_request_latency_milliseconds_sum", snapshot.latencyTotalMs],
    ["donut_collector_request_latency_milliseconds_count", snapshot.latencyCount],
  ];
  const gauges: Array<[string, number]> = [
    ["donut_collector_uptime_seconds", Math.max(0, (Date.now() - Date.parse(snapshot.startedAt)) / 1_000)],
    ["donut_collector_last_request_timestamp_seconds", epochSeconds(snapshot.lastRequestAt)],
    ["donut_collector_last_success_timestamp_seconds", epochSeconds(snapshot.lastSuccessAt)],
    ["donut_collector_last_new_transaction_timestamp_seconds", epochSeconds(snapshot.lastNewTransactionAt)],
    ["donut_collector_request_latency_milliseconds_max", snapshot.latencyMaximumMs],
  ];
  return `${[
    ...counters.map(([name, value]) => `# TYPE ${name} counter\n${name} ${value}`),
    ...gauges.map(([name, value]) => `# TYPE ${name} gauge\n${name} ${value}`),
  ].join("\n")}\n`;
}

function epochSeconds(timestamp: string | null): number {
  return timestamp === null ? 0 : Math.max(0, Date.parse(timestamp) / 1_000);
}
