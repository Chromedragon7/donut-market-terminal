# Collector behavior and polling

`apps/collector` is the only runtime component allowed to call the DonutSMP-compatible upstream. The browser, hosted API, and future Minecraft mod read retained data from the hosted API instead. `DONUT_API_KEY` therefore belongs only on the collector service.

## What a run records

Each transaction or listing scan creates a durable collection run. For every attempted page, the collector records request and response timing, response byte count, safe rate-limit headers, HTTP/error state, validation state, and the raw response body by content hash. Valid records are normalized; invalid records and normalization failures are appended to quarantine with their raw evidence and validation version.

A completed run records request, response, received, new, duplicate, invalid, and error counts; latency count/mean/maximum; the current rate-budget snapshot; pages completed; a checkpoint; source health; and any detected gap. Finalizing a run, its health sample, gaps, checkpoint, and aggregate refresh occurs in one database transaction.

Raw evidence and observation tables are append-only at the database level. Aggregates do not replace evidence.

## Modes

| Mode | Behavior today |
| --- | --- |
| `continuous` | Repeats transaction scans and, when enabled, broad listing scans. Transactions win whenever both are due. |
| `one_shot` | Runs one transaction scan, then one listing scan only when listings are enabled and the transaction scan did not fail. `--once` selects this mode. |
| `validation` | Records the run as validation and performs the same single-pass schedule as one-shot mode. It does **not** yet conduct or summarize a 48–72-hour study. |

The current scheduler has two implemented request classes: completed transactions and broad active listings. Watched-item listing polls, metadata refreshes, and backfills are not scheduled yet. Creating a watchlist does not currently change collector priority.

## Safe defaults and rate budget

The defaults in code are provisional safety values, not measurements of the configured mirror:

- Up to 10 transaction pages every 15 seconds.
- Active-listing collection disabled until explicitly enabled.
- When enabled, at most 25 listing pages per scan, a 10-second scan budget, and a 60-second interval.
- 200 requests per rolling minute, with 60 percent reserved for transaction continuity. Configuration rejects values above 250 requests/minute.
- Four provider attempts with bounded exponential retry, jitter, and `Retry-After` handling.
- Run-level backoff grows after partial/failed runs and resets after success.

The exact rolling-window limiter prevents listing/background work from consuming transaction-reserved capacity. The compatible-API client has an additional bounded provider limiter for retries. These defaults must be tuned only after the [API validation study](api-validation-study.md).

Relevant variables are documented in [Configuration and secrets](configuration.md). Runtime bounds are enforced by `apps/collector/src/config.ts`.

## Listings and transaction continuity

Transaction scans traverse the configured page count and treat malformed pages or records as partial evidence rather than crashing the process. A likely continuity gap is recorded only when all ten configured pages were captured and the prior newest source timestamp is older than the current rolling window's oldest timestamp. Failed or partial scans also create a possible gap covering the run interval.

Listing scans stop on documented null padding, an empty result, an out-of-range-page response after page one, the configured page maximum, or the scan time budget. A listing snapshot is `complete` only when a terminal page was observed and there were no errors or invalid records. Otherwise it is retained as `partial` or `failed`; it is never silently promoted to a complete market view.

Because the upstream documents no stable listing identifier, listing fingerprints are probabilistic and each scan is retained as a separate observation. A low ask may no longer be available.

## Restart and deployment safety

An advisory lock plus a renewable, fenced database lease permits one leader per source scheduler. A second replica stays non-ready rather than collecting concurrently. At startup, the leader marks abandoned runs from another instance as partial. Checkpoints are advanced only when a run is finalized; duplicate control is handled independently by versioned fingerprints and decisions.

SIGINT and SIGTERM abort sleep and requests, stop new work, close the health server, and close the database pool. Railway uses collector liveness for deployment health so a rolling deployment is not blocked by the old leader; monitor readiness separately.

## Health and metrics

- `GET /health/live` reports whether shutdown has begun.
- `GET /health/ready` requires a running leader, a ready database, and no known upstream authorization failure.
- `GET /metrics` exposes process-local Prometheus counters for requests, responses, records, duplicates, invalid records, throttles, authentication/upstream/database failures, run counts, and latency.

Collector metrics reset when the process restarts. Durable run and source-health records are the source for historical operations reporting. The collector metrics endpoint is currently unauthenticated; do not attach a public domain to the collector until metrics authentication or a private metrics path is added.

The collector currently does not persist browser/mod delivery time, queue delay, alert-delivery failures, backup state, or a complete validation-study report. Those states must remain unknown rather than inferred.
