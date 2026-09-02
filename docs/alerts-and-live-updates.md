# Alerts and live updates

Alert configuration and live market transport are separate capabilities. A stored alert rule is not proof that an evaluator ran or a notification was delivered.

## Alert rules implemented today

Authenticated users can create, list, replace, enable/disable, and delete their own rules through `/v1/alerts` and the Alerts website page. Mutations require the session cookie, an exact allowed origin, and the matching CSRF token.

Supported rule shapes are:

- Ask below a fixed threshold.
- Ask below a completed-sale median by a percentage.
- Completed-sale threshold.
- Price movement, recorded-volume spike, or observed-supply change by percentage.
- New variant observed.
- Source stale, collector failure, or historical gap.
- Low-confidence item signal.

Price thresholds are nonnegative decimal strings. Item-scoped rules require an item ID; percentage rules require a percentage. Cooldowns are stored from 30 seconds through 30 days, and rules can be disabled without deletion.

## Current alert boundary

The repository does **not** yet contain an alert evaluator, scheduler, trigger-deduplication service, notification inbox, or delivery provider. The `alert_events` table can retain immutable, deduplicated trigger evidence, but no current worker writes it and no API lists or acknowledges alert events. Cooldown values are configuration only until that worker exists.

Consequently, the current Alerts page manages rules but does not deliver browser, email, Discord, or in-game notifications. Treat UI phrases such as “cooldown-aware” as the intended rule contract, not evidence of active delivery.

An evaluator must eventually consume committed aggregates/outbox events, reject stale or insufficient-confidence inputs according to each rule, create one durable event per dedupe key, enforce cooldown transactionally, and enqueue a bounded privacy-safe notification. Delivery retries and failures must be observable and must never duplicate the market observation itself.

## Resumable live transport

The hosted API provides two authenticated paths over the durable PostgreSQL outbox:

- `GET /v1/events?cursor=…&limit=…` returns a bounded catch-up page.
- `GET /v1/stream?cursor=…` opens Server-Sent Events (SSE); `Last-Event-ID` is also accepted.

The API sends backlog first, then polls PostgreSQL for new events and fans them out to matching authenticated audiences. SSE supplies numeric event IDs, a five-second reconnect hint, and 15-second heartbeats. Stream opens are rate-limited. Seller/privacy filtering is applied before serialization.

New logical completed transactions enqueue the internal event `market.transaction.recorded`; persisted listing snapshots enqueue `market.listing.changed`; and finalized aggregate refreshes enqueue `market.summary`. The hosted API maps those internal names to the public stream contract `sale.recorded`, `listing.changed`, and `market.summary`.

The overview browser listens to all three public market event types and refetches retained headline values. Item-detail pages fetch when opened or when their chart range changes; they do not yet subscribe to SSE. Collection-health changes and alert triggers do not have separate live events.

## Resume and failure semantics

Clients should persist the last successfully applied cursor, request catch-up after a disconnect, then reconnect the stream using that cursor. Event application must be idempotent because reconnects can replay a boundary event. If the API is unavailable, the browser/mod must fail closed and must never call the upstream compatible API directly.

Outbox retention and an explicit cursor-expired response are not implemented yet. Do not prune outbox rows until a retention contract, cursor-expired error, and resynchronization path exist. End-to-end browser/mod delivery latency is also not recorded yet.
