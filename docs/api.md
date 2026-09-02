# Hosted API behavior and research references

All `/v1` market and personal resources are private. Browser sessions use `donut_session` (HttpOnly) plus a readable `donut_csrf` cookie. Mutations require an exact allowed `Origin` and matching `X-CSRF-Token`. Read-only mod clients use a scoped bearer token issued by `/v1/mod-tokens`; it never contains or grants access to the upstream key.

| Area | Routes |
| --- | --- |
| Operations | `GET /health/live`, `GET /health/ready`, protected `GET /metrics`, optional `GET /openapi.json` |
| Authentication | `POST /v1/auth/login`, `GET /v1/auth/session`, `POST /v1/auth/logout` |
| Market | `GET /v1/market/overview`, `/v1/items`, `/v1/items/:itemId`, plus `/listings`, `/sales`, and `/history` |
| Quality | `GET /v1/sources`, owner-only `/v1/collection-health`, `/v1/features` |
| Personal | CRUD `/v1/watchlists`, `/v1/alerts`, `/v1/dashboards`; `GET /v1/export` |
| Mod access | list/create/revoke `/v1/mod-tokens` |
| Live | bounded `GET /v1/events`; resumable SSE `GET /v1/stream` using `cursor` or `Last-Event-ID` |

Lists use a bounded opaque cursor and `limit` (maximum 100). Prices are decimal strings with `priceUnit: "server_currency"`; timestamps are RFC 3339 UTC. Errors use `{"error":{"code","message","requestId","details?"}}`. Unknown properties fail validation rather than being silently removed.

`/v1/orders`, `/v1/shop-prices`, and `/v1/fees` return `501 FEATURE_UNAVAILABLE`. `/v1/features` distinguishes `disabled`, `unavailable`, and `unknown`.

## Compatible upstream assumptions to validate

The expected active-list endpoint is `GET /v1/auction/list/{page}`, unusually with an optional JSON body containing `search` and `sort`. Pages reportedly start at 1, contain 44 positions, may be null-padded, and lack a stable listing id. The expected completed-sales endpoint is `GET /v1/auction/transactions/{page}`; at most ten pages of 100 newest records are reportedly exposed, with no buyer or stable transaction id. These are expected behaviors, not guarantees for the mirror, and the collector laboratory must measure them before tuning polling.

Research reference set (research date 2026-09-01; revalidate before operational decisions):

- [Official compatible API document](https://api.donutsmp.net/doc.json)
- [Community field documentation](https://donutapi.pages.dev/)
- [Command reference](https://github.com/donutdb/donutsmp-wiki/blob/main/wiki/Wikitext/Commands/commands.toml)
- [Shop-removal update](https://github.com/donutdb/donutsmp-wiki/blob/main/wiki/Wikitext/Updates/Shop%20removal%20update.sgw)
- [Donut Tracker limitations](https://donut-tracker.com/limitations/)
- [GLAZED limitations](https://glazed.gg/about/limitations)
- [Retired Orders API notice](https://donut.auction/api)

Community sources are operational evidence, not authoritative guarantees.
