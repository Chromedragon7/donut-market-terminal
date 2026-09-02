# Normalization and deduplication

Normalization is versioned and evidence-preserving. It makes source records queryable without pretending that missing metadata or missing upstream identifiers can be reconstructed.

## Boundary validation

The compatible adapter parses JSON with lossless numeric lexemes and validates the envelope and every record at runtime. Null-padded listing positions are represented explicitly. Unknown keys, missing optional fields, and nonfatal shape differences produce issues and a partial state; fatal identity, quantity, price, or timestamp failures produce an invalid state.

Invalid records and normalization failures are quarantined with the raw record, issue list, source, page, position, observation time, and validation version. A malformed record does not crash the rest of the page. The original raw page body is retained separately by content hash.

## Exact quantities and prices

The source item count is the observed quantity. The code never assumes that a stack contains 64 items. Zero, negative, missing, or out-of-range quantities are rejected.

Prices are stored as the source text, a canonical decimal, and an exact unit-price rational numerator/denominator. Unit price is total stack price divided by observed quantity. API responses expose decimal strings rather than binary floating-point currency values.

Active asking prices and completed sale prices remain different record types, tables, aggregates, labels, and API resources.

## Item and variant identity

Base item IDs are normalized to lowercase namespaced identifiers when valid. Version `item-variant/v1` currently fingerprints a canonical representation of:

- Base/source item ID.
- Display name and lore.
- Sorted enchantment IDs and exact levels.
- Armor-trim material and pattern.
- Recursive container entries and their quantities/fingerprints, to a default maximum depth of four.
- Whether each supported metadata field was absent, null, or present.

Unicode text is normalized to NFC. Canonical JSON and SHA-256 make the fingerprint deterministic for the same normalized input.

The current compatible schema does not fully model every modern data component, potion component, damage/durability value, shard/server signature, book content, map data, or arbitrary plugin metadata. Component-sensitive items such as potions, enchanted books, maps, heads, bundles, written books, tipped arrows, and fireworks are therefore marked ambiguous when required components are unavailable. Container-depth truncation and missing enchantment identity also prevent exact analytics.

Variant identity states are `exact`, `strong`, `broad`, `incomplete`, `ambiguous`, `excluded`, or `unclassified`. Only complete evidence is suitable for exact variant analytics. Raw evidence remains available for later reprocessing under a new normalization version.

## Completed-transaction deduplication

The upstream supplies no stable transaction ID. Version `transaction-fingerprint/v1` hashes:

- Source ID.
- Item-variant fingerprint.
- Seller UUID, falling back to normalized seller name when UUID is missing.
- Exact total price and observed quantity.
- Source sale timestamp in milliseconds.

Identical records within one complete scan are treated as a multiset and receive one-based occurrence ordinals. This avoids silently dropping two legitimate identical same-millisecond sales. The durable logical key is source, base fingerprint, occurrence ordinal, and dedupe version. Reobserving the same key is recorded as a repeat and updates last-observed time; it does not create another logical transaction.

This is conservative, not conclusive identity. Two indistinguishable real sales can collide, while reorder, page overlap, or a changing rolling window can affect occurrence ordinals. Ordinals claim identity only within an observation/scan. Collision state, confidence, and every dedupe decision are retained so later algorithms can be audited.

## Active-listing observations

The upstream supplies no stable listing ID. Version `listing-probabilistic-fingerprint/v1` hashes source, variant, seller, exact price, quantity, and an approximate expiration bucket derived from observation time plus remaining time. Network latency, changing remaining time, missing seller UUID, and missing remaining time make this identity probabilistic.

Every listing snapshot is retained; identical fingerprints do not prove one persistent listing. Current active-ask queries use the latest non-failed snapshot for each source. A low ask may no longer be available, and a partial snapshot is not evidence of full market depth.

## Aggregation and quality

Aggregates operate on logical completed transactions and retained listing snapshots, never on a mixed ask/sale series. Recorded quantity and turnover cover only observations captured by this collector and may not equal true total market volume. Median and quantity-weighted mean use exact stored values. Historical gaps and partial listing snapshots lower completeness instead of being interpolated away.

Confidence labels summarize identity completeness, observation quality, collisions, freshness, gaps, and sample context. They are not probabilities or guarantees. Fees remain unknown until an enabled effective-dated rule has evidence, so gross spread must not be labeled net profit.

## Known reprocessing gap

The version fields and retained evidence support future re-normalization and dedupe comparison, but no background reprocessing command or side-by-side migration workflow is implemented yet. Changing a version string alone does not rebuild historical rows.
