# Troubleshooting

Never paste `DONUT_API_KEY`, database URLs, password hashes, session secrets, cookies, or mod tokens into an issue, chat, screenshot, or shared command output. Redact URLs because they can contain credentials.

## API will not start

- Confirm Node.js 22.13+ and that `pnpm install` completed from the workspace root.
- Build and run migrations: `pnpm --filter @donut/db build` then `pnpm --filter @donut/db migrate`.
- In production, `DATABASE_URL` is required. The API refuses the in-memory repository unless `ALLOW_IN_MEMORY_REPOSITORY=true`; that override is for disposable previews only.
- Confirm `OWNER_USERNAME`/`OWNER_EMAIL`, `OWNER_PASSWORD_HASH`, `SESSION_SECRET`/`TOKEN_HASH_SECRET`, `SELLER_PSEUDONYM_SECRET`, exact public origin, and production metrics credential satisfy the bounds in [Configuration and secrets](configuration.md).
- A database TLS error usually means `DATABASE_SSL` disagrees with the provider. Do not disable TLS for an external database merely to suppress the error.

`/health/live` proves only that the process can answer. `/health/ready` also checks repository readiness. Use the structured startup error and request ID, not secrets, when diagnosing a failure.

## Collector is live but not ready

Collector readiness requires a database connection, leadership, and no known upstream authorization failure.

- `leader: false` can be normal during a rolling deployment while the previous healthy replica owns the advisory lock/lease. If it persists, inspect both replicas and `collector_leases` before restarting anything.
- `upstreamAuthorized: false` means verify the collector-only `DONUT_API_KEY`, base URL, and key permissions. Do not move the key to API/web variables.
- A partial run is retained and creates a possible gap. Inspect collection runs, source requests, and quarantine; do not delete the gap to make health look green.
- Repeated throttle responses mean lower the configured budget or cadence and honor the study results. Do not raise above the published ceiling.

The collector `/metrics` endpoint has no authentication today. Keep the collector without a public domain or place it behind a private authenticated metrics path.

## No active listings appear

`COLLECTOR_LISTING_ENABLED` defaults to `false`. Enable it only after validating the mirror and configure bounded page/time limits. Even when enabled, a scan can be partial if it reaches the page maximum or time budget before observing a terminal page.

The active view uses each source's latest non-failed snapshot. A low ask may no longer be available, and no snapshot proves that every source listing was captured.

## Transactions or item search are empty

- Collection cannot recover history from before it started or transactions that already left the rolling source window.
- Confirm transaction runs succeeded and that valid records were normalized rather than quarantined.
- Search returns only retained canonical items/variants; there is no seeded production catalog.
- Missing/invalid base item IDs cannot become canonical items. Component-sensitive variants may be ambiguous or excluded from exact analytics while their raw evidence remains retained.

## Sign-in, cookie, CORS, or CSRF failure

- `PUBLIC_APP_ORIGIN` must exactly equal the website origin, including scheme and port and excluding a trailing slash.
- `NEXT_PUBLIC_API_ORIGIN` must point to the hosted API, and browser fetches must include credentials.
- Use HTTPS and secure cookies in production. `COOKIE_SECURE=false` is a local-development-only setting.
- A mutation requires the `donut_session` cookie plus `X-CSRF-Token` equal to the readable `donut_csrf` cookie. A stale tab may need a fresh sign-in.
- Login errors are intentionally generic. Regenerate the scrypt hash interactively if the configured hash is malformed; never store the plaintext password.

## Website says the API is offline

Check API readiness and the browser's configured API origin. Public `NEXT_PUBLIC_*` changes require a web rebuild/restart. The browser intentionally does not call the compatible upstream as a fallback.

The overview normally refetches on public `sale.recorded`, `listing.changed`, and `market.summary` events. If it does not, verify stream authentication, origin, cursor, API event mapping, and aggregate finalization. Item details do not subscribe yet; reload those views when checking fresh evidence.

## SSE reconnect or missing events

Use `GET /v1/events` with the last applied numeric cursor, apply the bounded backlog idempotently, then connect `/v1/stream` with `cursor` or `Last-Event-ID`. A malformed cursor returns a stable client error.

Explicit cursor expiration is not implemented and outbox retention has no pruning contract. Do not manually delete outbox history. Current market emission covers new logical completed transactions, listing snapshots, and finalized aggregate summaries.

## Alerts do not fire

Alert-rule CRUD is implemented, but the evaluator and notification-delivery worker are not. Stored cooldown and dedupe fields do not cause execution by themselves. See [Alerts and live updates](alerts-and-live-updates.md).

## Migration or integration-test failure

- Ensure no unrelated database shares the test URL. Integration tests modify their target database.
- Database-package integration uses `DONUT_DB_INTEGRATION=1` with `DATABASE_URL`.
- API PostgreSQL integration uses `API_POSTGRES_TEST_URL`.
- Migrations use an advisory lock; investigate another active migration before terminating a session.
- Restore an isolated backup and test forward migration there before retrying a production failure.

## Railway plan or deploy failure

- Install the current official Railway CLI, authenticate, link the intended project/environment, and confirm `railway config plan` reads `.railway/railway.ts`.
- Create required shared variables before planning. The repository source is intentionally omitted from IaC and must be connected separately.
- Review every planned deletion and variable change before apply. Never use secret-value display in shared logs.
- If the web health check fails, verify its production runtime binds to Railway's `PORT`. If the collector health check fails during a roll, remember IaC intentionally uses liveness; readiness is monitored separately.

See [Railway deployment](railway.md) for the current service layout and IaC migration note.
