---
name: DonutSMP rate limit backoff
description: API returns 429 with no Retry-After header; client retried with short backoff burning 5 requests per attempt.
---

The DonutSMP API (behind Cloudflare) enforces a rate limit of 250 requests per minute but returns no `Retry-After` response header. The client defaulted to short exponential backoff (max 8 s) and retried 4 times per 429, sending 5 total requests on each collector invocation — all hitting the limit and extending the block window.

**Why:** Without a `Retry-After` header, the client had no signal about the reset window. Rapid retries compounded the problem: each retry counted against the quota.

**How to apply:**
- `classify()` in `client.ts` now defaults `retryAfterMs` to 65,000 ms (65 s = one full minute window + buffer) when no `Retry-After` header is present.
- Avoid making direct curl test calls to the API while collectors are running; each test call counts against the shared key quota.
- If debugging collector behavior, check `sync_runs.error_summary` — the error now includes the first 300 chars of the raw JSON response body to identify the actual API format mismatch.
