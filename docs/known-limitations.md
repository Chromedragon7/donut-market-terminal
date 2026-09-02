# Known limitations

- Collection cannot recover transactions from before it started or records that rolled out of the newest-1,000 window before capture. Historical gaps must remain visible.
- The upstream documents no stable listing or transaction id; composite fingerprints can collide and deduplication is uncertain.
- Active asks are not completed sales, a low ask may no longer exist, and recorded volume may not equal total volume.
- Buyer data is unavailable. Fees, taxes, seller net proceeds, listing cancellation behavior, and exact expiration behavior are unknown.
- Special-item values can be unreliable when metadata is missing. Identical-looking variants may not be economically identical.
- Exact mirror base URL, latency, rate enforcement/headers, total listing pages, redistribution rules, and automation/client-observation permission remain unverified.
- Orders and shop/base prices have no verified provider and remain unavailable. Client observation and every automated market action remain disabled.
- The API's in-memory adapter is test/preview infrastructure. `DATABASE_URL` selects the durable PostgreSQL adapter; migrations must complete before API startup.
- SSE reconnect uses the durable numeric outbox cursor and a polling fan-out. PostgreSQL `LISTEN/NOTIFY` is not required; tune `OUTBOX_POLL_MS` from measured load.
- The current JSON export is synchronous and refuses more than 20,000 variants or 100,000 listings/sales. A background streaming archive is required for larger retained histories.
- The schema has no backup-run table, so `backupState` remains `unknown`; external backup monitoring must feed a future durable record.
- Browser CSRF hashes and mod-token labels use the existing `sessions.metadata` JSON field. This is durable but not separately indexed.
- `source_health_samples.metrics` is provider-shaped JSON; latency is reported only when the collector writes a numeric `latencyMs` field.
- Active listings are the observations belonging to each source's latest non-failed snapshot. The upstream has no stable listing id, so this cannot prove a listing is still executable.
- Active-listing collection is disabled by default pending mirror validation. The scheduler currently implements transaction and broad-listing lanes only; watchlists do not change polling priority, and metadata/backfill lanes are not scheduled.
- `COLLECTOR_MODE=validation` is currently a single evidence run. The required continuous 48–72-hour study, schema-drift analysis, appearance-delay measurement, and report generator are not implemented.
- Alert rules are durable CRUD records only. No evaluator, cooldown/dedupe execution worker, alert inbox, or notification-delivery provider exists yet.
- The overview uses resumable live market events, but item-detail, watchlist, alerts, and collection-health views do not subscribe to targeted updates.
- Collector `/metrics` is unauthenticated and process-local. The collector must remain private until a protected metrics path is added.
- Time-series tables have BRIN/bounded indexes but are not partitioned. There is no compressed object archive/catalog or historical reprocessing command yet.
- The website has no end-to-end browser test suite, sign-out control, invitation/user administration, export control, mod-token manager, drag/reorder dashboard editor, or persistent general preferences.
- `.railway/railway.ts` has not been planned/applied against the user's Railway environment. Repository sources, domains, backups/PITR, external monitoring, and the Vinext production `PORT` path still require deployment verification.

This product is independent and not officially affiliated with DonutSMP.
