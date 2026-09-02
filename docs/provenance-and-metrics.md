# Provenance and metric definitions

Every listing, sale, aggregate, and export must preserve a source id/type, collector observation time, source timestamp when available, collector version, freshness, confidence, sample size, completeness, and flags. Raw evidence is retained separately and is never replaced by aggregates.

- **Active ask:** the seller's observed total listing price. It is not a sale and may no longer be available.
- **Completed sale:** a transaction visible in the rolling completed-transactions source. No buyer field exists.
- **Unit price:** total price divided by observed quantity. Stackability is never assumed to be 64.
- **Recorded quantity/turnover/volume:** only records captured by this collector. Recorded volume may not equal true total market volume.
- **Median:** middle observed unit-sale price after deterministic ordering; even samples average the two center values.
- **Quantity-weighted mean:** sum of total recorded value divided by recorded quantity.
- **Lowest ask:** minimum currently observed unit ask; it is not a guaranteed executable price.
- **Gap:** a known interval where continuity or collection completeness failed. Gaps remain visible in every time range.

Freshness states are `live`, `recent`, `stale`, or `unknown`; production thresholds are source-specific configuration informed by measured polling and latency. Confidence is `high`, `medium`, `low`, or `unknown` and considers identity quality, sample size, freshness, gaps, source trust, and anomaly flags. It is not a probability or guarantee.

Special variants with missing enchants, names, lore, trims, potion data, durability, or container contents must be `incomplete`, `ambiguous`, or excluded from variant analytics. Fees remain unknown until an effective-dated evidence record exists; gross spread must never be labeled net profit.
