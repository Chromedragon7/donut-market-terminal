---
name: Setup-status DB guard
description: Why DB-backed setup/status endpoints must early-return when the DB is unconfigured
---

Any route that reads the database (especially `/api/setup-status`) must check
`Boolean(process.env.DATABASE_URL)` and return a fully-formed response *before*
touching `db`.

**Why:** `lib/db` connects lazily via a Proxy so imports don't throw at boot. But
the first actual query calls `getPool()`, which throws when `DATABASE_URL` is
missing. A setup-status route that always queries will 500 in exactly the
unconfigured state it's meant to report on — breaking the frontend setup gate.

**How to apply:** In setup/health/status handlers, branch on `databaseConfigured`
first and return defaults (counts 0, timestamps null, `hasData:false`,
`stale:true`). Only run real queries when the DB is configured.
