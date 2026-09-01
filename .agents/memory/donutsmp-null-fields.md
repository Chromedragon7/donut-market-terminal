---
name: DonutSMP schema null fields
description: DonutSMP API sends null (not undefined) for optional fields — Zod schemas must use .nullish() everywhere.
---

The DonutSMP auction/transaction endpoints return JSON where numeric fields like `price`, `count`, `time_left`, `unixMillisDateSold` and string fields like `id`, `display_name`, `uuid` can be `null` rather than absent.

Zod `.optional()` only accepts `undefined`; `null` causes a validation failure on the parent array, which propagates up and causes the entire top-level schema parse to fail with "Upstream response failed validation". This silently results in 0 rows inserted.

**Why:** The leaderboard endpoint never sent null values so it worked fine; listings and transactions did, exposing the bug only for those endpoints.

**How to apply:**
- All fields in `AhSchema`, `PurchaseItemSchema`, `ItemSchema`, `ContainerItemSchema`, `SellerSchema`, `LeaderboardEntrySchema`, and all response schemas must use `.nullish()` instead of `.optional()`.
- Downstream code that reads these fields must use `?? undefined` when passing to functions that expect `string | undefined` (not `string | null | undefined`).
- `sortedLevels()` in `variant.ts` must filter out null enchantment level values before mapping.
- The client `request()` function also normalizes bare-array responses (`Array.isArray(raw) ? { result: raw } : raw`) and non-object responses as a defense-in-depth measure.
