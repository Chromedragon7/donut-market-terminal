---
name: Money math boundary
description: Where decimal.js must be used vs where Number conversion is allowed
---

User-facing monetary arithmetic (simulator cost accumulation, fees, revenue,
break-even, slippage) must be computed with `Decimal` (re-exported from
`@workspace/donut`, configured precision 40, ROUND_HALF_UP). Convert to JS
`Number` ONLY at the response/display boundary (`.toNumber()` / `.toFixed()`).

**Why:** the spec forbids floating-point money math; accumulating `take *
unitPrice` in JS floats drifts. A code review specifically rejected the simulator
for doing buy/sell arithmetic in Number.

**How to apply:** DB numeric columns arrive as strings — wrap in `new Decimal(...)`
before any arithmetic. Reading values purely for transport (mapping a row's
unitPrice to JSON) may use `Number()` since JSON has no decimal type, but never
do `+`, `*`, `/` on those Numbers for money.
