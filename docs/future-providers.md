# Future Orders and client-observation providers

The documented compatible API does not expose Orders, itemized shop/base prices, buyer data, or fees. These values must remain unavailable or unknown until a verified, permitted source exists.

## Current integration boundary

The durable `sources` table can identify provider type, endpoint metadata, trust, enablement, and health. Every retained observation links to a source. The hosted API exposes explicit feature states and returns `501 FEATURE_UNAVAILABLE` for `/v1/orders`, `/v1/shop-prices`, and `/v1/fees`.

This is a compatibility boundary, not a completed provider plug-in framework: only the compatible Auction House listing and completed-transaction client is implemented. There are no Orders, shop, manual-observation, client-observation, or server-metadata adapters yet. Database entities for Orders/client submissions are also not present.

The database does include disabled effective-dated fee-rule storage with source, scope, calculation, evidence, confidence, and effective interval. No rule is enabled by default. Gross spread must not be labeled net profit while applicable fees are unknown.

## Orders provider contract

A future verified Orders adapter should emit source-separated, append-only observations with:

- Observable order identifier, or an explicitly probabilistic identity.
- Canonical item/variant and identity completeness.
- Creator/buyer identity only when legitimately visible and permitted.
- Requested and remaining quantity.
- Exact unit buy price and total reserved value.
- Observed, source-created, expiration, fill, and completion times when available.
- Raw evidence/content hash, adapter and schema versions, source, confidence, and flags.

Orders must have separate active depth, fill history, volume, and candles. They must not be inserted into Auction House asks or completed-sale aggregates. Highest buy order, order depth, fill volume, Auction-versus-Order spread, and net opportunity remain unavailable until the source and applicable fees are verified.

## Passive Java client observation

Client observation remains disabled. Before implementing it:

1. Confirm server rules and obtain explicit operator/user permission.
2. Confirm the exact Minecraft Java, loader, mapping, and dependency versions.
3. Define a signed, revocable, rate-limited submission protocol distinct from read-only mod tokens.
4. Bind every submission to server identity, screen/source type, client and collector versions, observation time, confidence, and safely captured raw evidence.
5. Validate and quarantine submissions server-side. Never trust client calculations or allow arbitrary record shapes.
6. Add source-specific health, drift detection, replay protection, and an owner review path before any data affects analytics.

Permitted future observations could include visible Orders screens, visible variant metadata, `/worth` or base-price output, shop prices, fee/deduction evidence, and expiration information. They must never be merged invisibly with compatible-API evidence.

## Minecraft mod boundary

The initial mod is still deferred because the supported Minecraft and loader matrix is unknown. When built, it must be a read-only authenticated client of the hosted API, hold only a revocable scoped mod token, redact that token, use TLS, and fail closed when the backend is unavailable. It must never contain `DONUT_API_KEY` or call the compatible upstream.

The mod may later show variant-aware price tooltips, held-item summaries, watchlist events, source/freshness/confidence/sample labels, and website deep links. Buying, selling, listing, command execution, GUI automation, macros, and assisted market actions remain outside the current product.

See [Minecraft mod version matrix](mod-version-matrix.md) for the unknowns that must be resolved first.
