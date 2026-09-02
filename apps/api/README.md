# Donut Market API

Strict Fastify/TypeScript API for authenticated market reads, personal watchlists, alerts, dashboards, exports, and resumable live updates.

The API intentionally does not contact the compatible upstream API and never accepts its key. With `DATABASE_URL`, it selects the durable PostgreSQL adapter and bootstraps the configured owner transactionally. The in-memory implementation exists only for tests or an explicitly disposable `ALLOW_IN_MEMORY_REPOSITORY=true` preview.

See [`../../docs/api.md`](../../docs/api.md), [`../../docs/configuration.md`](../../docs/configuration.md), and [`../../docs/local-development.md`](../../docs/local-development.md).
