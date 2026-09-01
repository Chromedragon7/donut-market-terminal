---
name: Listings collector partial-commit
description: Collector skipped the DB commit entirely when the page cap was hit (status="partial"), resulting in 0 insertions.
---

The `runListingsSync` collector staged all listings in memory across pages, then committed them atomically only when `out.status === "complete"`. The page cap (`auctionMaxPages`, default was 50) set `out.status = "partial"` on the last page. With 175 pages of real listings data, every run hit the cap and discarded all 2200+ staged records.

**Why:** The "complete-only" guard was meant to avoid replacing a valid snapshot with an obviously incomplete one. But a partial snapshot is better than no snapshot, and 0 insertions is worse than a partial view.

**How to apply:**
- The commit condition is now `if (staged.length > 0)` — always commit when there is staged data.
- `auctionMaxPages` default raised from 50 to 200 (overridable via `DONUT_AUCTION_MAX_PAGES` env var).
- `out.status` still records "partial" in `sync_runs` for visibility, but it no longer gates the insert.
