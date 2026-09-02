# Railway deployment

The repository defines project-level Railway Infrastructure as Code in `.railway/railway.ts`. It declares one PostgreSQL resource and one replica each of the API, collector, and web services. No Redis, queue, separate analytics worker, volume, bucket, custom domain, or external monitoring service is currently declared. Aggregates are refreshed during collection finalization.

## Current Railway format

Railway's current project-level format is TypeScript Infrastructure as Code (IaC). The older per-service `railway.json`/`railway.toml` **Config as Code is deprecated**: new services cannot adopt it, and Railway says legacy files stop being read on December 1, 2026. This project therefore uses only `.railway/railway.ts`. See Railway's current [Infrastructure as Code documentation](https://docs.railway.com/infrastructure-as-code) and [Config as Code deprecation notice](https://docs.railway.com/config-as-code).

IaC is project/environment scoped, and omission can mean deletion after Railway owns a resource. Always review the plan. A service still managed by legacy Config as Code must be migrated before IaC can manage it.

## What the current file configures

| Resource | Build/start | Health | Important boundary |
| --- | --- | --- | --- |
| `postgres` | Railway PostgreSQL resource | Provider managed | Permanent evidence database; backups/PITR still require setup and restore drills. |
| `api` | Builds API and dependencies; runs advisory-lock-protected migrations before start | `/health/ready` | Receives database and app/session/privacy/metrics variables, never `DONUT_API_KEY`. |
| `collector` | Builds collector and dependencies; starts continuous collector | `/health/live` | Receives `DONUT_API_KEY`; listings remain disabled by default. Readiness must be monitored separately. |
| `web` | Builds and starts Vinext web | `/` | Receives only public `NEXT_PUBLIC_*` origins. Its Railway production runtime/`PORT` binding must be proven before release. |

API and collector use the private database URL with TLS disabled in the current file. Do not copy that setting to a public/external database connection. The API has a durable PostgreSQL repository whenever `DATABASE_URL` is set; never enable the in-memory preview adapter for retained production data.

The source repository is intentionally absent from IaC because its owner/URL is unknown. Connect the repository/branch to the three services separately. Generate public domains only for web and API; keep collector health/metrics private because collector `/metrics` is currently unauthenticated.

## Plan and apply

1. Install the TypeScript `railway` package with the workspace and install the current official Railway CLI separately. Check `railway --version`.
2. Run `railway login`, then link the exact project and environment with `railway link`.
3. Connect this repository as the deployment source for `web`, `api`, and `collector`.
4. Define all shared variables referenced by `.railway/railway.ts`: owner identity/hash, token/session hash secret, seller-pseudonym secret, metrics token, compatible API base URL/key, and public web/API origins.
5. Run `railway config plan` (or `pnpm railway:plan`). Do not use `--show-values` in shared output.
6. Reject any unexpected deletion, service replacement, variable removal, or unrelated change. Apply only the reviewed plan with `railway config apply`.

`DONUT_API_KEY` is referenced only by the collector service. `NEXT_PUBLIC_API_ORIGIN` and `NEXT_PUBLIC_SITE_ORIGIN` are browser-visible and must contain only public origins.

## Deployment and migration behavior

The API start command runs `pnpm --filter @donut/db migrate` before API startup. The collector also calls the migration runner at startup. The migration table/advisory lock prevents concurrent application, but every migration still needs staging validation, a backup, and a rollback-compatible application plan.

Collector leadership uses a PostgreSQL advisory lock plus a fenced lease. Liveness is used for the Railway rollout so a new replica does not fail deployment merely because the old replica still leads. Alert if `/health/ready` remains non-ready after rollout. Confirm Railway restart and deployment-draining settings explicitly; the current IaC file does not set a restart policy or drain interval.

Do not horizontally scale the collector to increase upstream requests. Additional collector replicas are standby only. API scaling should be tested against the database connection budget, outbox polling, session behavior, and SSE load before changing the one-replica configuration.

## Production gates

Before applying to production:

- Complete the full workspace build/test/typecheck and PostgreSQL integration tests.
- Prove web, API, and collector start commands on Railway, including injected `PORT`, SIGTERM, health checks, and private networking.
- Complete the [API validation study](api-validation-study.md) before enabling listings or tuning cadence.
- Configure TLS/public domains for web/API and verify exact-origin cookies, CSRF, CSP, and SSE reconnect.
- Configure provider backups/PITR where available, encrypted off-platform logical backups, monitoring, and a successful isolated restore drill.
- Add an external monitor for API readiness, collector readiness/lag, database capacity, and backup age.
- Treat alert evaluation/delivery, targeted live updates outside the overview, cursor-expiry handling, and the Java mod as incomplete rather than production capabilities.

Monitor API/collector uptime, newest and oldest captured transaction times, polling/processing age, request latency, throttling and authentication failures, partial runs, invalid/duplicate records, metadata incompleteness, gaps, database failures/size/connections, SSE connections, outbox growth, and backup/restore age. Queue delay and alert-delivery failures remain unknown until those workers exist.

## Capacity, backups, and domains

Do not choose a plan or volume from guesses. Use [Storage growth and retention planning](storage-growth.md) to measure transaction/listing rates, raw and normalized bytes, index and aggregate overhead, backup multiplication, and days-to-capacity. Re-check current [Railway plans](https://docs.railway.com/pricing/plans) before purchasing or resizing.

Follow [Backup and restoration](backup-restore.md). Railway snapshots/PITR are one layer, not the only recovery path. Add a custom domain only after the generated domains pass authentication, secure-cookie, CORS, SSE, health, and restore tests; update all three public-origin variables together.
