# Donut Market Terminal

A production-ready, DB-backed analytics dashboard for the DonutSMP game economy (unofficial/fan-made): item prices, auctions, leaderboards, player profiles, and a trade simulator.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (dev port 5000, proxied at `/api`)
- `pnpm --filter @workspace/web run dev` — run the web frontend (served at `/`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/db run generate` — generate a Drizzle SQL migration into `lib/db/migrations` after schema changes
- `pnpm --filter @workspace/db run migrate` — apply pending migrations (deterministic deploy flow)
- `pnpm --filter @workspace/scripts run collect -- <job>` — run a collector job (`transactions`, `listings`, `leaderboards`, `watched`, `rollups`, `cleanup`, `all`)
- Required env: `DATABASE_URL`, `DONUTSMP_API_KEY` (server-only), `ADMIN_PASSWORD`, `SESSION_SECRET`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Web: React + Vite, wouter routing, TanStack Query, shadcn/ui, Tailwind, echarts (candlesticks/sparkline)
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/api-server/src/routes/*.ts` — all API route handlers (market, items, auctions, leaderboards, players, simulator, admin)
- `artifacts/web/src/pages/*.tsx` — page components (home, market, auctions, item-detail, leaderboards, player, simulator, data, about, admin)
- `artifacts/web/src/App.tsx` — wouter routes + QueryClient (global `retry: false`)
- `lib/db` — Drizzle schema (source of truth for tables)
- `lib/donut` / `lib/donut-data` — rate-limited DonutSMP API client + data access; `donut-data` re-exports `@workspace/db` tables
- `lib/api-spec` — OpenAPI spec (source of truth for API contract)
- `lib/api-zod/src/generated` + `lib/api-client-react/src/generated` — codegen outputs (Zod schemas + React Query hooks)
- `scripts/src/collect.ts` — CLI collector entrypoint

## Architecture decisions

- DONUTSMP_API_KEY is server-only; the browser never sees it. All upstream calls go through the rate-limited client in `lib/donut`.
- Money stored as Postgres numeric and handled with decimal.js — no floating-point money math.
- Items grouped by canonical SHA-256 `variant_hash` (base item id + normalized enchants/trim/lore/contents); `base` vs `variant` scope toggles aggregation.
- Collectors are idempotent CLI jobs guarded by Postgres advisory locks so runs never overlap.
- Admin auth: ADMIN_PASSWORD + signed session cookie; admin status endpoint returns 401 when unauthenticated (frontend uses this to gate the login screen).
- We never call DonutSMP moderation/Shield endpoints.

## Product

User-facing pages: Overview (`/`), Market Screener (`/market`), Live Auctions (`/auctions`), Item Detail (`/items/:scopeKey`), Leaderboards (`/leaderboards`), Player Profile (`/players/:username`), Trade Simulator (`/simulator`), Data & Methodology (`/data`), About (`/about`), Admin (`/admin`). All pages render honest empty states before collectors have run. A site-wide footer carries the unofficial/fan-made disclaimer.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Item history is fetched via query-param URL (`/api/items/history?scopeKey=...`); the detail/listings hooks take a `scopeKey` string, history/transactions take params objects.
- `scopeKey` is URL-encoded in routes — decode it in the page before passing to hooks.
- Leaderboards `category` must always be passed by the frontend (omitting it stringifies to `"undefined"` upstream).
- After changing a `lib/*` package, run `pnpm run typecheck:libs` before leaf artifact checks.
- echarts-for-react candlestick expects data as `[open, close, low, high]` order.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
