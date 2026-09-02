# Local development

Prerequisites are Node.js 22.13+, pnpm 11, and Docker for PostgreSQL-dependent components.

1. Run `pnpm install` at the repository root.
2. Copy `.env.example` to `.env`; leave the compatible upstream URL/key as placeholders until collector validation is intentionally run.
3. Start PostgreSQL with `docker compose up -d postgres`, then run `pnpm --filter @donut/db build` and `pnpm --filter @donut/db migrate`.
4. Run `pnpm --filter @donut/api hash-password`. The password is read interactively without echo; place only the resulting scrypt hash in `OWNER_PASSWORD_HASH`.
5. Add local-only `SELLER_PSEUDONYM_SECRET` and, when exercising protected metrics, `METRICS_BEARER_TOKEN`.
6. Run `pnpm dev:api`. The API dev command reads the root `.env`; `DATABASE_URL` selects the PostgreSQL adapter.
7. Make the public `NEXT_PUBLIC_*` values available to the web process, run `pnpm dev:web`, then open the configured site origin and sign in through `/login`.
8. Only when a real mirror key is configured securely, make the collector/database variables available to that process and run `pnpm dev:collector`. The collector requires `DONUT_API_KEY` and is the only process allowed to call the upstream.
9. Check API and collector `/health/live` and `/health/ready`, then use the API `/openapi.json` in development.

Run `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm lint` before handoff. Default tests use fixtures, mocks, an in-memory API repository, and Fastify injection; they do not require the real upstream key. Database integration tests are opt-in: the database package uses `DONUT_DB_INTEGRATION=1` with `DATABASE_URL`, and the API adapter uses `API_POSTGRES_TEST_URL`. Never point either at production.

The included entrypoint intentionally blocks production use of the in-memory repository. A disposable preview can set `ALLOW_IN_MEMORY_REPOSITORY=true`, but its data vanishes on restart and it is not an MVP storage deployment.

Active listing collection is disabled by default. Do not enable it or treat current polling defaults as measured until completing the [compatible API validation study](api-validation-study.md).

The API development script explicitly loads the root `.env`. The current web and collector development scripts do not pass that root file explicitly, so confirm their process environments rather than assuming the copied file was loaded. Do not solve this by copying `DONUT_API_KEY` into the web directory.
