# Gilded Market Intelligence

Gilded is a private, source-aware economy tracker for a DonutSMP-compatible testing mirror. It continuously preserves obtainable Auction House evidence, keeps active asks separate from completed sales, and is designed for a responsive web dashboard plus a future read-only Java client mod.

The project is independent and is not officially affiliated with DonutSMP.

## Current status

Implemented foundations include:

- Strict compatible-API adapters for active listings and completed transactions.
- Exact raw-response retention metadata, tolerant boundary validation, and explicit quarantine states.
- Versioned item/variant normalization, exact money arithmetic, conservative deduplication, freshness, confidence, and gap helpers.
- PostgreSQL migrations for ingestion, analytics, users, sessions, watchlists, alerts, dashboards, feature availability, audit, and live-event outbox data.
- Restart-aware collector scheduling with transaction-first reserved capacity, backoff, rate budgeting, health, and metrics. Broad listing collection is deliberately disabled until the mirror is validated.
- Private Fastify API with owner authentication, CSRF/origin checks, seller privacy, OpenAPI, data export, watchlists, alerts, dashboards, and resumable SSE.
- Responsive Gilded dashboard routes with honest pre-collection and unavailable states.
- Project-level Railway Infrastructure as Code for PostgreSQL, API, collector, and web services.

Orders, shop/base prices, fee-derived net profit, passive client observation, the Minecraft mod, and all transactional automation are disabled. The mod cannot start until the exact Minecraft, Java, and loader version matrix is confirmed.

Current boundaries are explicit: alert rules can be stored but no evaluator/delivery worker exists; validation mode is a single evidence run rather than the required 48–72-hour study/report; watchlists do not yet alter polling priority; and item-detail/other secondary pages do not yet subscribe to targeted live updates. See [Known limitations](docs/known-limitations.md).

## Local development

Requirements: Node.js 22.13 or newer, pnpm 11, and PostgreSQL 17 (or Docker for the included local database service).

1. Copy `.env.example` to `.env` and replace placeholders locally. Never commit `.env`.
2. Install dependencies with `pnpm install`.
3. Start PostgreSQL with `docker compose up -d postgres`, or provide your own `DATABASE_URL`.
4. Build and apply migrations with `pnpm --filter @donut/db build` followed by `pnpm --filter @donut/db migrate`.
5. Generate the owner password hash with `pnpm --filter @donut/api hash-password` and store only the result in `OWNER_PASSWORD_HASH`.
6. Start the API, collector, and web dashboard with `pnpm dev:api`, `pnpm dev:collector`, and `pnpm dev:web` in separate terminals. The API script loads the root `.env`; the current collector/web scripts require their variables in the process environment, so do not assume they loaded that file or copy the upstream key into the web app.

The collector is the only component permitted to contact the upstream compatible API. Configure `DONUT_API_KEY` locally or as a Railway secret; never expose it to the web app or a future mod.

## Verification

Run the workspace checks from the repository root:

```text
pnpm typecheck
pnpm test
pnpm build
pnpm lint
```

PostgreSQL integration tests are opt-in and require the documented test database variable.

## Documentation

Start with the [documentation index](docs/README.md), especially:

- [Architecture](docs/architecture.md)
- [Compatible API behavior](docs/api.md)
- [Collector behavior and polling](docs/collector.md)
- [API validation study](docs/api-validation-study.md)
- [Normalization and deduplication](docs/normalization-and-deduplication.md)
- [Data provenance and metric definitions](docs/provenance-and-metrics.md)
- [Alerts and live updates](docs/alerts-and-live-updates.md)
- [Website setup and usage](docs/website.md)
- [Configuration and secret handling](docs/configuration.md)
- [Railway deployment](docs/railway.md)
- [Storage growth and retention planning](docs/storage-growth.md)
- [Backup and restoration](docs/backup-restore.md)
- [Future Orders and client observation](docs/future-providers.md)
- [Known limitations](docs/known-limitations.md)
- [Minecraft mod version matrix](docs/mod-version-matrix.md)
- [Troubleshooting](docs/troubleshooting.md)
