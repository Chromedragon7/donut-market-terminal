# Website setup and usage

The Gilded website is a responsive private dashboard in `apps/web`. It calls only the hosted application API. It never receives `DONUT_API_KEY` and never falls back to the compatible upstream when the hosted API is unavailable.

## Configuration

Set these public build/runtime values on the web service:

- `NEXT_PUBLIC_API_ORIGIN`: public HTTPS origin of the hosted API, without a trailing slash.
- `NEXT_PUBLIC_SITE_ORIGIN`: canonical public HTTPS origin of the website.

Set the same website origin as `PUBLIC_APP_ORIGIN` on the API so CORS, origin validation, and CSRF checks agree. `NEXT_PUBLIC_*` values are visible to every browser and must never contain credentials.

For local development, the same-origin fallback is used when `NEXT_PUBLIC_API_ORIGIN` is empty. If web and API run on different local ports, set both origins explicitly and restart the web process after changing public build values.

Build with `pnpm --filter @donut/web build` and start with `pnpm --filter @donut/web start`. Before production, verify that the selected Vinext runtime binds to Railway's injected `PORT`, serves `/`, and preserves cookies and SSE through the public proxy.

## Sign in

Open `/login` and use the configured owner username and plaintext password used to generate `OWNER_PASSWORD_HASH`. The password is sent only to the hosted API over HTTPS; it is not the compatible upstream key. The API issues an HttpOnly `donut_session` cookie and a readable `donut_csrf` cookie for same-user mutations.

There is currently no website sign-out control, invitation screen, user administration, or mod-token manager. The corresponding session/logout and mod-token API resources exist, but these workflows need UI before invite-only use is complete.

## Current pages

| Route | Current behavior |
| --- | --- |
| `/` | Private market overview, collector/source state, feature availability, recorded 24-hour sale quantity/turnover, and latest observed ask counts. |
| `/items` | Debounced search of retained canonical items/variants. No fake catalog rows are inserted. |
| `/items/:id` | Item identity/quality, range-selectable history, latest observed asks, and recorded completed sales. Gaps break chart lines. |
| `/watchlist` | Create, list, and delete per-user watchlists. Creating a watchlist does not yet change collector polling priority. |
| `/alerts` | Create, list, enable/disable, and delete alert rules. Evaluation and delivery are not implemented; see [Alerts and live updates](alerts-and-live-updates.md). |
| `/collection` | Owner-only collection-health summary and source continuity context. The 48–72-hour study panel remains at zero until a real study runner/report exists. |
| `/settings` | Create/delete simple persisted dashboard layouts. Seller/privacy controls shown there are disabled explanatory states. |

The item chart offers 24-hour, 7-day, 30-day, and all-history ranges with hour/day/week aggregation. Exact decimal strings are kept for labels and hover values; the rendered vertical positions are normalized for display. Completed-sale median and lowest active ask are separate series. A low ask may no longer be available, recorded volume may not equal total volume, and no buyer data is available.

Dashboard layout records can preserve cards, coordinates, theme, and density through the API. The current website editor creates and deletes a simple layout but does not yet provide drag/reorder, arbitrary card arrangement, chart preferences, configurable headline metrics, or rendering a saved layout as the overview.

Retained data export is available at authenticated `GET /v1/export`; there is no export button in the website yet. The synchronous JSON export is bounded as described in [Known limitations](known-limitations.md).

## Empty and unavailable states

Before collection starts, the site shows empty evidence rather than demo prices. A 401 leads to a sign-in state; an unreachable hosted API leads to an offline state; unknown item evidence yields a not-found state. Orders, shop/base prices, and fees are shown as unavailable/unknown through feature state rather than estimates.

Special items remain separate when metadata is incomplete. History begins only when this collector starts, and recorded gaps remain visible.

## Live-update status

The API's authenticated resumable SSE endpoint is implemented. It maps internal outbox event names to the public `sale.recorded`, `listing.changed`, and `market.summary` contract, and the overview refetches retained headline values on each. Item-detail pages do not subscribe yet. Details are in [Alerts and live updates](alerts-and-live-updates.md).

## Responsive verification

Before release, manually verify sign-in, item search/detail, all chart ranges, asks, sales, watchlist and alert forms, dashboard layout persistence, collection health, unavailable feature labels, keyboard focus, and narrow mobile layouts against a deployed API/database. Automated browser end-to-end tests are not yet present.
