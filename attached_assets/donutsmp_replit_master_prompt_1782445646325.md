# Replit Agent Master Prompt — Donut Market Terminal

Build a production-ready, full-stack web application on Replit called **Donut Market Terminal**. It is an unofficial analytics dashboard for the DonutSMP game economy. Do not build a static mockup, landing page, or demo-only dashboard. Build the real database-backed application, connect it to the documented DonutSMP API through the server, add scheduled data collectors, implement the analytics, and test the finished app.

Start in Plan Mode. First inspect this full specification, produce a short implementation plan, then implement it without dropping requirements. Prefer a clean, maintainable first production version over unnecessary experimental features. Use current stable package versions available in Replit.

## 1. Non-negotiable requirements

1. Never expose the DonutSMP API key to the browser. The browser must call only this app's own backend routes.
2. Read the key only from the Replit Secret/environment variable `DONUTSMP_API_KEY`.
3. Never hard-code, print, return, serialize, or log the API key. Redact authorization headers from logs and error reports.
4. Use Replit's managed PostgreSQL database for persistent data.
5. Use Replit Scheduled Deployments for collectors. Do not run cron loops inside the web server process because autoscaling or multiple instances could create duplicate collectors.
6. Build a rate-limited API client with retries and a soft limit below the documented maximum.
7. Do not invent undocumented DonutSMP endpoints.
8. The official API has no documented `/orders` endpoint. Do not label estimated demand as a real order book. Build an honest simulation based on listings and transaction history, and provide an adapter interface for a future authorized order-data source.
9. Do not call any Shield `PUT` endpoint. Shield endpoints are listed below only for API completeness and are outside this economy app's scope.
10. Add a visible footer disclaimer: “Unofficial community analytics dashboard. Not affiliated with DonutSMP, Mojang, or Microsoft.” Do not use an official logo unless the owner later supplies an asset they are authorized to use.
11. Production pages must not use fake market data. Fixtures are allowed only in automated tests and local story/demo states clearly labeled as fixtures.
12. If the API key or database is not configured, show a polished setup-status page instead of crashing.

## 2. Recommended stack and project structure

Use a TypeScript full-stack application with:

- Frontend: React + Vite, TypeScript, Tailwind CSS, shadcn/ui.
- Data fetching/state: TanStack Query.
- Tables: TanStack Table and virtualization for large result sets.
- Charts: Apache ECharts for time-series, candlestick/OHLC, volume, histograms, brush zoom, and tooltips.
- Backend: Node.js + TypeScript + Express or Fastify. Choose one and keep it consistent.
- Validation: Zod for environment variables, API responses, query parameters, imports, and form inputs.
- Database: Replit PostgreSQL with Drizzle ORM and versioned migrations.
- Exact money math: PostgreSQL `numeric` columns plus a decimal library such as `decimal.js`. Avoid binary floating-point for calculations shown to users.
- Tests: Vitest for unit/integration tests and Playwright for browser tests.
- Logging: structured server logs with secret redaction.

Organize the repository clearly, for example:

- `client/` — React application
- `server/` — HTTP server, app API routes, auth, data services
- `shared/` — Zod schemas, TypeScript types, formatting utilities
- `scripts/` — scheduled sync, aggregation, cleanup, and import commands
- `db/` — Drizzle schema and migrations
- `tests/` — unit, integration, and browser tests
- `docs/` — architecture, API mapping, data limitations, deployment guide

The app should start locally with one command such as `npm run dev`, and production should have explicit build and start commands.

## 3. Official DonutSMP API contract

Base URL:

`https://api.donutsmp.net`

Swagger document:

`https://api.donutsmp.net/doc.json`

Authentication header for every official API request:

`Authorization: Bearer ${DONUTSMP_API_KEY}`

The documented limit is 250 requests per minute per API key. Implement a shared token-bucket or queue with a default soft cap of 200 requests per minute, concurrency of 3 or less, request timeout, exponential backoff with jitter, and support for `Retry-After` on 429 responses. User-facing pages must read from our database instead of fanning out to the upstream API on every visit.

### 3.1 Auction endpoints

#### Current auction listings

`GET /v1/auction/list/{page}`

Path parameter:

- `page`: integer

The Swagger document describes an optional JSON request body:

```json
{
  "search": "diamond",
  "sort": "lowest_price"
}
```

Documented sort examples are `lowest_price`, `highest_price`, `recently_listed`, and `last_listed`.

A GET request body is nonstandard and can be stripped by clients or proxies. The collector should default to fetching paginated listings without a request body and perform searching/sorting locally. If server-side search is implemented, keep it in the backend API client, test it, and fall back to local behavior if the upstream or HTTP client rejects a GET body.

Response shape:

```ts
interface AhResponse {
  result?: Ah[];
  status?: number;
}

interface Ah {
  item?: Item;
  price?: number;
  seller?: Seller;
  time_left?: number; // treat as milliseconds; retain raw value too
}
```

#### Recent completed auction transactions

`GET /v1/auction/transactions/{page}`

- Page minimum: 1
- Page maximum: 10
- 100 transactions per page
- Ordered by sale date

Response:

```ts
interface TransactionHistoryResponse {
  result?: PurchaseItem[];
  status?: number;
}

interface PurchaseItem {
  item?: Item;
  price?: number;
  seller?: Seller;
  unixMillisDateSold?: number;
}
```

This endpoint exposes at most the most recent 1,000 transactions at a time. It cannot reconstruct months of older official history on day one. On first setup, backfill all currently available pages, then continuously collect and deduplicate future transactions. Add an admin CSV/JSON importer for older owner-supplied history.

### 3.2 Shared auction data structures

```ts
interface Item {
  id?: string;
  display_name?: string;
  count?: number;
  enchants?: ItemData;
  trim?: Trim; // tolerate this if it appears even though the official schema nests trim in ItemData
  lore?: string[];
  contents?: ContainerItem[];
}

interface ContainerItem {
  id?: string;
  display_name?: string;
  count?: number;
  enchants?: ItemData;
}

interface ItemData {
  enchantments?: Enchantments;
  trim?: Trim;
}

interface Enchantments {
  levels?: Record<string, number>;
}

interface Trim {
  material?: string;
  pattern?: string;
}

interface Seller {
  name?: string;
  uuid?: string;
}
```

Treat every field as potentially absent or malformed. Keep the validated normalized columns and the original record in `raw_json` for debugging. Never render lore as HTML; render it as escaped text.

### 3.3 Leaderboard endpoints

All use `GET`, bearer authentication, and a `{page}` integer path parameter:

- `/v1/leaderboards/brokenblocks/{page}`
- `/v1/leaderboards/deaths/{page}`
- `/v1/leaderboards/kills/{page}`
- `/v1/leaderboards/mobskilled/{page}`
- `/v1/leaderboards/money/{page}`
- `/v1/leaderboards/placedblocks/{page}`
- `/v1/leaderboards/playtime/{page}`
- `/v1/leaderboards/sell/{page}`
- `/v1/leaderboards/shards/{page}`
- `/v1/leaderboards/shop/{page}`

Response:

```ts
interface LeaderboardResponse {
  result?: LeaderboardEntry[];
  status?: number;
}

interface LeaderboardEntry {
  username?: string;
  uuid?: string;
  value?: string;
}
```

Preserve `value` exactly as returned. Also parse a normalized numeric or duration value when possible, but do not discard the raw string. Parsing failures must not break the page.

### 3.4 Player endpoints

#### Player lookup

`GET /v1/lookup/{user}`

```ts
interface LookupResponse {
  result?: {
    location?: string;
    rank?: string;
    username?: string;
  };
  status?: number;
}
```

#### Player statistics

`GET /v1/stats/{user}`

```ts
interface StatsResponse {
  result?: {
    broken_blocks?: string;
    deaths?: string;
    kills?: string;
    mobs_killed?: string;
    money?: string;
    money_made_from_sell?: string;
    money_spent_on_shop?: string;
    placed_blocks?: string;
    playtime?: string;
    shards?: string;
  };
  status?: number;
}
```

Player requests should be server-side, cached in the database, and rate limited. Refresh on demand only when the cached record is stale.

### 3.5 Shield endpoints — document but exclude from the economy UI

These are part of the Swagger document but are not needed for auction/economy analytics:

- `GET /v1/shield/bedrock/config/{service}`
- `PUT /v1/shield/bedrock/config/{service}`
- `GET /v1/shield/java/config/{service}`
- `PUT /v1/shield/java/config/{service}`
- `GET /v1/shield/metrics/{service}`
- `GET /v1/shield/stats/{service}`
- `GET /v2/shield/bedrock/config/{service}`
- `PUT /v2/shield/bedrock/config/{service}`

Relevant response shapes:

```ts
interface BedrockShieldConfig {
  backends?: string[];
}

interface ShieldConfig {
  regionalizedBackends?: Array<Record<string, string[]>>;
}

interface MetricsResult {
  result?: string[];
}

interface OriginStats {
  stats?: Record<string, number>;
}
```

Do not expose, proxy, or call these endpoints in this app. In particular, never call the `PUT` operations.

### 3.6 Error responses

```ts
interface NoAuthResponse {
  message?: string;
  reason?: string;
  status?: number; // normally 401
}

interface InvalidResponse {
  message?: string;
  reason?: string;
  status?: number; // normally 500
}
```

Create typed errors for unauthorized, rate-limited, timeout, upstream-invalid, validation-failed, and transient-server-error cases. Show safe, useful error states to the admin without revealing secrets.

## 4. Data identity and normalization

A Minecraft base item and an exact item variant are not the same market. The app must support both views.

Create a canonical item variant representation from:

- base `item.id`
- normalized display name
- enchantment names and levels sorted by key
- armor trim material and pattern
- lore, preserving order but normalizing harmless whitespace/control codes
- container contents, recursively normalized and sorted deterministically where order is not meaningful

Do not include listing quantity, seller, price, or timestamps in the variant identity.

Generate a stable SHA-256 `variant_hash` from canonical JSON. Support two analysis scopes:

1. **Base item scope** — all variants sharing `item.id`
2. **Exact variant scope** — only one `variant_hash`

Default broad browsing to base item scope. Let users switch to exact variants, especially for enchanted gear, trims, named items, or container contents. Show a warning when a base-item chart mixes materially different variants.

Compute:

- `quantity = max(item.count ?? 1, 1)`
- `total_price = upstream price`
- `unit_price = total_price / quantity`

Store money in PostgreSQL `numeric`, not float. Show both total and unit price. Format compact values such as K/M/B/T while showing the exact amount in tooltips.

## 5. PostgreSQL schema

Create versioned Drizzle migrations, appropriate foreign keys, unique constraints, and indexes. Use UTC `timestamptz` internally.

Implement at least these tables:

### `item_variants`

- `id`
- `base_item_id`
- `display_name`
- `normalized_display_name`
- `variant_hash` unique
- `enchantments_json`
- `trim_json`
- `lore_json`
- `contents_json`
- `canonical_json`
- `created_at`
- `updated_at`

Indexes for base item, display name, and variant hash.

### `sales_transactions`

- `id`
- `dedupe_hash` unique
- `item_variant_id`
- `seller_name`
- `seller_uuid`
- `quantity`
- `total_price`
- `unit_price`
- `sold_at`
- `first_seen_at`
- `raw_json`

Build `dedupe_hash` from canonical transaction fields such as sold timestamp, seller UUID/name, variant hash, quantity, and total price. Because the upstream has no transaction ID, document that this is a best-effort identity. Handle rare same-millisecond duplicates by using an occurrence index within an identical batch rather than silently deleting legitimate duplicates.

Indexes on `(item_variant_id, sold_at desc)`, `(sold_at desc)`, seller UUID, base item through joins, and unit price where useful.

### `current_auction_listings`

Keep only the latest complete listing snapshot here:

- `id`
- `snapshot_id`
- `item_variant_id`
- `seller_name`
- `seller_uuid`
- `quantity`
- `total_price`
- `unit_price`
- `time_left_ms`
- `approx_expires_at`
- `raw_json`

Load a new complete snapshot into staging and replace the published current set atomically. If a sync is partial or fails, keep the previous complete snapshot and mark data stale instead of publishing an incomplete market.

### `listing_market_snapshots`

Store compact historical listing aggregates rather than every raw listing forever:

- bucket timestamp
- base item ID
- optional exact variant ID/hash
- active listing count
- listed quantity
- minimum ask
- p25 ask
- median ask
- average ask
- p75 ask
- maximum ask
- weighted average ask
- source snapshot ID

Unique key across scope and bucket. Keep months of these compact snapshots.

### `market_price_rollups`

Roll up completed sales for intervals `5m`, `1h`, and `1d`:

- scope key, such as `base:<item_id>` or `variant:<hash>`
- interval
- bucket start
- open unit price
- high
- low
- close
- median
- mean
- p25
- p75
- sold quantity
- transaction count
- total traded value
- distinct seller count
- sample confidence score

Unique key `(scope_key, interval, bucket_start)`.

### `leaderboard_snapshots`

- `id`
- category
- captured at
- page count
- complete/partial status
- sync run ID

### `leaderboard_entries`

- snapshot ID
- category
- rank
- username
- UUID
- raw value string
- parsed numeric value nullable
- parsed duration seconds nullable

Unique per snapshot/category/rank.

### `players`

- UUID if available
- latest username
- latest lookup location/rank
- first seen
- updated at

### `player_stat_snapshots`

- player identity
- captured at
- every raw stat string
- normalized numeric/duration fields when parsable
- raw JSON

### `sync_runs`

- job type
- started/finished timestamps
- status
- upstream request count
- pages fetched
- records seen
- records inserted/updated
- complete or partial
- safe error summary
- last cursor/page

### `data_imports`

- import ID
- uploaded filename
- started/finished timestamps
- status
- rows read/accepted/rejected
- validation report

## 6. Collectors and scheduled jobs

Create idempotent CLI commands:

- `npm run sync:transactions`
- `npm run sync:listings`
- `npm run sync:leaderboards`
- `npm run sync:watched-players`
- `npm run rollup:market`
- `npm run cleanup:data`
- `npm run sync:all`

Use PostgreSQL advisory locks or an equivalent database lock so two copies of the same job cannot overlap.

### Transaction collector

- Default schedule: every 2 minutes.
- Fetch pages 1 through 10.
- Validate, normalize, and deduplicate.
- Upsert item variants.
- Insert unseen transactions.
- Recompute affected 5-minute rollups immediately and enqueue/recompute 1-hour and 1-day rollups.
- Stop safely on auth failure; back off on rate limiting.

### Current listing collector

- Default schedule: every 5 minutes.
- Start at page 1 and continue until an empty result, a repeated page fingerprint, an explicit configured cap, or an upstream failure.
- Make maximum pages configurable with `DONUT_AUCTION_MAX_PAGES`.
- Mark a run partial if the cap is reached before a natural end.
- Never replace the published current listing set with a partial run.
- After a complete run, atomically replace `current_auction_listings` and generate base-item plus exact-variant listing aggregates.
- Do not retain every raw full-market snapshot forever. Keep current raw listings and compact historical aggregates. Add a configurable short raw-snapshot retention only if useful for debugging.

### Leaderboard collector

- Default schedule: every 30 minutes, offset from auction jobs.
- Fetch every documented category.
- Start at page 1 and continue until empty or configured `DONUT_LEADERBOARD_MAX_PAGES`.
- Preserve complete snapshots so rank changes can be calculated.

### Player collector

- Lookups and stats are normally on demand.
- Cache for a configurable time such as 15 minutes.
- Allow the owner to maintain a watched-player list that is refreshed on a slower schedule.

### Cleanup and retention

- Keep transaction history long term.
- Keep aggregated market rollups long term.
- Make raw-data retention configurable.
- Never delete the latest complete listing snapshot.
- Log size/row counts in the admin page.

## 7. Historical-data import

Create a protected admin import wizard for CSV or JSON files containing older auction transactions.

Required/recognized fields:

- item ID
- display name
- quantity
- enchantments JSON
- trim JSON
- lore JSON
- contents JSON
- total price
- seller name
- seller UUID when known
- sold timestamp

The wizard must:

1. Upload and parse without executing content.
2. Show a preview and detected column mapping.
3. Validate rows with Zod.
4. Show accepted/rejected counts and row-level errors.
5. Deduplicate against existing history.
6. Commit in a database transaction.
7. Rebuild affected rollups.
8. Store an import audit record.

Provide a downloadable CSV template generated by the app.

## 8. Analytics and market calculations

Implement transparent, explainable calculations. Never claim guaranteed profit or certainty.

For each base item and exact variant, calculate where enough samples exist:

- latest sale
- best current ask
- median current ask
- 1-hour, 24-hour, 7-day, and 30-day median sale price
- percentage change over those windows
- sales count and sold quantity
- total traded value
- active listings and listed quantity
- sales velocity per hour/day
- listing-to-sales ratio
- estimated days of supply
- volatility using returns or robust median absolute deviation
- current ask premium/discount versus recent median sale
- high/low range
- data confidence based on sample size, recency, and missing collector intervals

Use medians and robust quantiles as the default for noisy markets. Do not hide raw outliers. Add an “exclude statistical outliers” chart toggle and explain the rule, such as an IQR-based filter, only when sample size is sufficient.

Build OHLC candles from completed sale unit prices sorted by sold time. If an interval has no trades, show a gap rather than fabricating a candle. Overlay configurable moving averages and volume. Support time ranges such as 1h, 6h, 24h, 7d, 30d, 90d, and all available data.

Create explainable market signals, not financial advice:

- “Below recent median”
- “Above recent median”
- “High liquidity”
- “Low sample size”
- “Unusually volatile”
- “Best ask is X% below/above 7-day median”

A composite opportunity score is acceptable only if the formula and component values are visible in a tooltip or details panel. Reduce confidence when data is sparse or stale.

Track collector gaps and render them on charts. Do not silently interpolate across missing source periods.

## 9. Buy/sell and order simulator

Create a `/simulator` page. This simulator must not place real orders or make authenticated changes to DonutSMP.

### Buy simulation using real current asks

Inputs:

- base item or exact variant
- quantity wanted
- optional maximum unit price
- optional fee/tax percentage, default 0 and clearly user-configurable

Algorithm:

1. Sort matching current listings by unit price ascending.
2. Walk the ask depth until the requested quantity is filled or liquidity ends.
3. Calculate quantity filled, quantity unfilled, total cost, average execution price, best ask, worst filled ask, and slippage versus best ask.
4. Show which listings would be consumed in the hypothetical fill.
5. Estimate short-term market impact by comparing remaining ask depth before and after the simulated purchase.

### Sell simulation without an official bid/order endpoint

Inputs:

- item/variant
- quantity
- proposed unit listing price
- acquisition cost per unit
- optional fee/tax
- time horizon

Show:

- gross and net revenue
- break-even price
- estimated profit/loss
- current listings ahead of this price
- current quantity ahead
- percent above/below recent sale medians
- recent sales velocity
- estimated time-to-sell range based on historical sales velocity and price position
- base, optimistic, and conservative scenarios based on robust price quantiles

Label these results prominently as estimates from completed sales and current asks, not a true demand order book. If data is insufficient, say so instead of manufacturing a result.

Create a clean `OrderDataSource` interface behind a feature flag such as `ORDER_DATA_SOURCE=none`. The UI can display “No authorized order feed configured.” Do not call an undocumented or third-party endpoint automatically.

## 10. Pages and user experience

### Global shell

- Responsive dark dashboard with a collapsible left navigation, top search/command bar, data freshness indicator, and theme toggle.
- Design language: polished “market terminal meets Minecraft,” using charcoal/obsidian surfaces, subtle grid texture, warm donut/coral accents, accessible green for gains and red for losses, and restrained animation.
- Do not copy an existing site pixel-for-pixel.
- Use deterministic voxel-style placeholder tiles based on item ID instead of downloading unlicensed game assets. Make the icon system replaceable later.
- Keyboard accessible controls, visible focus states, good contrast, reduced-motion support, useful empty states, skeleton loaders, and responsive mobile layouts.

### `/` — Market overview

Include:

- total traded value for 24h and 7d
- transaction count and sold quantity
- active current listings
- data last updated and freshness
- most traded items
- biggest gainers and losers with minimum-volume filters
- most volatile liquid items
- items with largest discount between best ask and recent median sale
- compact sparklines
- collector/data-quality warning card when feeds are stale or incomplete

### `/market` — Market screener

A virtualized sortable table with:

- item/variant
- best ask
- latest sale
- 24h median
- 24h and 7d change
- 24h volume
- active listings
- liquidity score
- volatility
- confidence

Filters:

- search by item ID/display name
- base versus exact variant scope
- price range
- volume range
- minimum transaction sample
- active listing range
- change range
- volatility range
- enchantment name and minimum level
- trim material/pattern
- include/exclude containers or custom lore
- stale-data exclusion

Allow column selection, saved views in local storage, URL-synchronized filters, CSV export of the current filtered table, and pagination/virtualization.

### `/auctions` — Current listings explorer

Show all current listings from the database with filters for:

- item ID/name
- seller name/UUID
- total price and unit price
- quantity
- enchantments and levels
- trim
- lore text
- container contents
- time remaining

Include compact/card and dense/table views, sorting, pagination, and a visible snapshot timestamp. Never imply that clicking a listing purchases it.

### `/items/:scopeKey` — Item detail

Include:

- item identity and exact variant information
- base/exact scope switch
- best ask, latest sale, medians, volume, liquidity, volatility, and confidence cards
- candlestick or line chart with 5m/1h/1d intervals
- volume bars
- moving-average overlays
- price distribution histogram
- current ask-depth chart
- current listing table
- recent sales table
- seller breakdown
- market signal details with formulas
- buttons to open the buy/sell simulator prefilled for this item

### `/leaderboards`

- Tabs for all 10 documented categories.
- Paginated current rankings.
- Rank movement since the previous snapshot.
- Search for a player.
- Historical chart for selected players where snapshots exist.
- Preserve and show the raw formatted value while using normalized values for charts when parsing succeeds.

### `/players/:username`

- Lookup data and current stats.
- Historical stat charts from snapshots.
- Appearances in leaderboards.
- Auction sales by the same seller identity when matched.
- Cache status and manual refresh for authorized/admin use.

### `/simulator`

Implement the simulator specified above with charts and a clear assumptions panel.

### `/data`

- Searchable transaction explorer.
- Date filters, item filters, seller filters, and exact/base scope.
- Export filtered results to CSV with server-side row limits and asynchronous generation if large.
- Data dictionary and methodology links.

### `/about`

Explain:

- data sources
- collection start date
- historical limitations
- update cadence
- base versus exact variants
- unit-price calculation
- outlier handling
- confidence calculation
- simulator limitations
- unofficial affiliation disclaimer

### `/admin`

Protect with a server-side admin login using `ADMIN_PASSWORD` and a signed HTTP-only session cookie using `SESSION_SECRET`, or use a native Replit auth option if it is simpler and equally secure. Do not expose admin APIs publicly.

Admin features:

- configuration status without revealing secret values
- last sync time and status for each collector
- request counts and rate-limit state
- run a manual sync safely
- failed validation samples with secrets removed
- partial/completeness status
- database row counts and approximate storage
- watched-player management
- historical CSV/JSON import
- data cleanup controls with confirmation
- collection start date and stale thresholds

## 11. Internal backend API

Create stable server routes with Zod-validated query parameters, pagination limits, and safe caching. Suggested routes:

- `GET /api/health`
- `GET /api/setup-status`
- `GET /api/market/overview`
- `GET /api/market/screener`
- `GET /api/auctions`
- `GET /api/items/:scopeKey`
- `GET /api/items/:scopeKey/history`
- `GET /api/items/:scopeKey/listings`
- `GET /api/items/:scopeKey/transactions`
- `GET /api/leaderboards/:category`
- `GET /api/players/:user`
- `POST /api/simulator/buy`
- `POST /api/simulator/sell`
- protected `/api/admin/*` routes

Use keyset pagination for large transaction tables where practical. Cap page size. Add sensible indexes and inspect slow queries.

## 12. Security and resilience

- Secrets are server-only environment variables.
- Do not prefix secrets with `VITE_` or otherwise include them in the client bundle.
- Add Helmet/security headers and a restrictive content security policy compatible with the app.
- Same-origin API by default; do not allow open CORS.
- Validate and bound every query/filter/import.
- Escape all upstream strings.
- Add rate limiting to public app API routes and stronger limits to login/manual-refresh endpoints.
- Use CSRF protection or same-site safeguards for state-changing admin routes.
- Use HTTP-only, secure, same-site cookies in production.
- Redact Authorization, cookies, passwords, and session secrets from logs.
- Handle upstream 401, 429, 500, malformed JSON, timeout, empty pages, duplicate pages, and schema drift.
- Never delete the last complete market snapshot because a new run failed.
- Add a database-backed health/freshness status and display stale data honestly.

## 13. Testing requirements

Create automated tests for at least:

- canonical item normalization and stable variant hashing
- enchantment key sorting
- container-content normalization
- total/unit price calculations with decimals
- transaction deduplication, including identical-batch occurrence handling
- page termination and repeated-page detection
- rate limiting and retry behavior using mocked upstream responses
- OHLC/median/volume rollups
- gap handling
- leaderboard value parsing
- buy-depth simulation and slippage
- sell estimate behavior when data is sparse
- Zod rejection of malformed API/import data
- admin authentication and authorization
- assurance that the client bundle does not reference or expose `DONUTSMP_API_KEY`

Use mocked DonutSMP responses for normal tests so tests do not spend real rate-limit capacity. Add Playwright tests that navigate the overview, market, item detail, auctions, leaderboards, player search, simulator, and admin login. Run Replit browser/app testing and fix visual or interaction issues before declaring completion.

## 14. Documentation and operator setup

Create:

- `README.md` with local and Replit setup
- `docs/API_MAPPING.md` listing every official endpoint above
- `docs/ARCHITECTURE.md`
- `docs/DATA_MODEL.md`
- `docs/METHODOLOGY.md`
- `docs/DEPLOYMENT.md`
- `.env.example` containing only variable names and harmless defaults, never real secrets

Expected environment variables:

```env
DONUTSMP_API_KEY=
DONUTSMP_API_BASE_URL=https://api.donutsmp.net
DATABASE_URL=
ADMIN_PASSWORD=
SESSION_SECRET=
DONUT_REQUESTS_PER_MINUTE=200
DONUT_REQUEST_CONCURRENCY=3
DONUT_AUCTION_MAX_PAGES=100
DONUT_LEADERBOARD_MAX_PAGES=10
TRANSACTION_SYNC_MINUTES=2
LISTING_SYNC_MINUTES=5
LEADERBOARD_SYNC_MINUTES=30
PLAYER_CACHE_MINUTES=15
RAW_DATA_RETENTION_DAYS=30
ORDER_DATA_SOURCE=none
```

Use Replit Database integration for `DATABASE_URL`. Tell the owner exactly which Secrets must be added in the workspace and in the published deployment. Include Scheduled Deployment instructions and commands. Suggested schedules:

- transactions every 2 minutes
- listings every 5 minutes
- market rollups every 5 minutes, offset from collection
- leaderboards every 30 minutes, offset from auction jobs
- cleanup daily

If Replit plan or cost constraints make those schedules unsuitable, make cadence configurable and document a lower-cost schedule without changing code.

## 15. Definition of done

Do not finish after generating UI components. The task is complete only when:

1. The project builds and runs in Replit.
2. Database migrations apply successfully.
3. Missing-secret setup states are polished.
4. With valid secrets, the server can fetch and validate official API data.
5. The first transaction backfill imports all currently available transaction pages.
6. Scheduled commands are implemented and idempotent.
7. Current listings are stored atomically and historical listing aggregates are generated.
8. Item detail charts render real stored data.
9. Filters, search, pagination, and exports work.
10. All 10 leaderboards work.
11. Player lookup and stats work through the backend cache.
12. The buy simulator walks actual current listing depth.
13. The sell simulator is clearly labeled as an estimate and handles insufficient data honestly.
14. The API key is never present in browser requests, source, logs, or client bundles.
15. Unit, integration, and browser tests pass.
16. The README contains exact Replit publishing, production-secret, database, and scheduled-job steps.
17. The footer and methodology pages clearly state that this is unofficial and that historical data begins at collection start unless older data is imported.

At the end, give the owner a concise completion report containing:

- what was built
- the routes/pages available
- the secrets they must add
- migration command
- collector commands and recommended schedules
- known upstream limitations
- tests run and their results
- any remaining step that requires the owner to click something in Replit's Publishing or Scheduled Deployments UI
