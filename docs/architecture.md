# Architecture

The monorepo separates five responsibilities:

1. The collector is the only component allowed to call the DonutSMP-compatible upstream. It validates, records raw evidence, normalizes, and writes collection health.
2. PostgreSQL is the permanent evidence store. Raw observations, normalized records, gaps, provenance, aggregates, user state, and the event outbox must survive restarts.
3. The hosted Fastify API authenticates users and read-only mod clients, queries a `MarketRepository`, applies seller privacy before serialization, and fans out outbox events.
4. The web application consumes only the hosted API. Browsers never receive the upstream key.
5. A future Java mod consumes only scoped, revocable hosted-API tokens. It remains read-only.

`apps/api/src/contracts.ts` is the adapter seam. The in-memory adapter is deterministic test infrastructure, not permanent storage. `apps/api/src/postgres-repository.ts` implements the contract with parameterized, bounded PostgreSQL queries and transactions over `@donut/db`. Repository records contain raw seller identity; only API serializers may create responses or exports.

Live updates use a durable-outbox model: clients first read `/v1/events?cursor=…`, then connect to `/v1/stream` with the last event id. The PostgreSQL transaction-ingestion path commits a new logical transaction and its privacy-safe outbox row atomically; the API maps internal event names to the public stream contract. Current event coverage, subscriber coverage, retention, and missing cursor-expired behavior are documented in [Alerts and live updates](alerts-and-live-updates.md).

Orders, shop prices, fee rules, passive client observations, and automated actions are separate provider/feature states. They are never inferred from Auction House data.
