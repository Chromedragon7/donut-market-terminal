# Configuration and secrets

Copy the root `.env.example` to `.env` for local work. Commit only placeholders. Use Railway variables in production.

| Variable | Purpose |
| --- | --- |
| `OWNER_USERNAME` or `OWNER_EMAIL` | Initial owner login identifier |
| `OWNER_PASSWORD_HASH` | Interactive scrypt utility output; never a plaintext password |
| `TOKEN_HASH_SECRET` or `SESSION_SECRET` | HMAC pepper for session and mod-token hashes; at least 32 random characters |
| `SELLER_PSEUDONYM_SECRET` | Stable HMAC secret for invited-user pseudonyms; at least 32 random characters |
| `ALLOWED_ORIGINS` or `PUBLIC_APP_ORIGIN` | Exact comma-separated browser origins; wildcard is rejected |
| `METRICS_BEARER_TOKEN` | Separate metrics credential; required in production |
| `API_HOST`, `API_PORT` | Listener; defaults to `0.0.0.0:3001` |
| `SESSION_TTL_SECONDS` | Session lifetime, bounded from 5 minutes to 30 days |
| `API_RATE_LIMIT_PER_MINUTE`, `LOGIN_RATE_LIMIT_PER_MINUTE` | Hosted API abuse limits |
| `REQUEST_BODY_LIMIT_BYTES` | Bounded JSON request size |
| `COOKIE_SECURE` | Enable Secure cookies outside production tests; always on in production |
| `EXPOSE_OPENAPI` | Expose `/openapi.json`; default off in production |
| `NEXT_PUBLIC_API_ORIGIN`, `NEXT_PUBLIC_SITE_ORIGIN` | Public browser build origins; never secrets |
| `DATABASE_URL`, `DATABASE_SSL` | PostgreSQL connection and TLS requirement; the durable adapter is selected whenever `DATABASE_URL` is set |
| `DATABASE_MAX_CONNECTIONS` | API pool maximum; size against the database connection budget |
| `OUTBOX_POLL_MS` | Database outbox-to-SSE polling interval; defaults to 1 second |
| `ALLOW_IN_MEMORY_REPOSITORY` | Explicit disposable preview override only; never retained production data |
| `DONUT_API_KEY` | Upstream bearer credential; collector service only |
| `DONUT_API_BASE_URL`, `DONUT_SOURCE_KEY`, `DONUT_SOURCE_DISPLAY_NAME` | Fixed compatible source endpoint and provenance identity |
| `COLLECTOR_MODE` | `continuous`, `one_shot`, or the current single-pass `validation` mode |
| `COLLECTOR_TRANSACTION_PAGES`, `COLLECTOR_TRANSACTION_POLL_MS` | Bounded completed-transaction scan and cadence |
| `COLLECTOR_LISTING_ENABLED`, `COLLECTOR_LISTING_MAX_PAGES`, `COLLECTOR_LISTING_SCAN_BUDGET_MS`, `COLLECTOR_LISTING_POLL_MS` | Explicit active-listing collection controls; disabled by default until validation |
| `COLLECTOR_REQUESTS_PER_MINUTE`, `COLLECTOR_TRANSACTION_RESERVE_PERCENT` | One key-wide budget and protected transaction capacity; hard maximum 250 requests/minute |
| `COLLECTOR_MAX_RUN_BACKOFF_MS`, `COLLECTOR_LEASE_TTL_MS`, `COLLECTOR_SHUTDOWN_GRACE_MS` | Failure backoff, leader lease, and shutdown bounds |
| `PORT` or `COLLECTOR_HEALTH_PORT` | Collector HTTP health/metrics port; Railway supplies `PORT` |
| `COLLECTOR_VERSION`, `DONUT_PROVIDER_VERSION`, `VALIDATION_VERSION`, `NORMALIZATION_VERSION`, `DEDUPE_VERSION`, `AGGREGATION_VERSION`, `SCHEDULE_VERSION` | Evidence/algorithm version tags; changing a tag does not reprocess existing history |
| `PGSSLMODE` | Set to `require` for the collector when PostgreSQL TLS is required |
| `DONUT_DB_INTEGRATION`, `API_POSTGRES_TEST_URL` | Opt-in local/integration test controls; never point them at production |

`DONUT_API_KEY` belongs only to the collector service. Do not define it on the web or mod, return it from the API, log it, or reuse it as any hosted-API secret. Rotate token/session/pseudonym secrets through a planned session invalidation and pseudonym-stability procedure. Never paste secrets into issues, chat, source, screenshots, or commands that remain in shell history.
