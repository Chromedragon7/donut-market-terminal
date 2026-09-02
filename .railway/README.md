# Railway infrastructure

This project uses Railway's current project-level TypeScript Infrastructure as Code format. It intentionally does not use the deprecated `railway.json`/`railway.toml` service format, which new services cannot adopt and Railway stops reading after December 1, 2026.

## Safe workflow

1. Install Railway CLI 5.42.1 or newer, run `railway login`, and link the intended project and environment with `railway link`.
2. Connect this repository as the source for the `web`, `api`, and `collector` services. Source is intentionally omitted from `railway.ts` because the repository owner/name is not known here; omitting it preserves source management outside IaC.
3. Define these Railway **shared variables** before planning:
   - `OWNER_USERNAME`
   - `OWNER_PASSWORD_HASH`
   - `TOKEN_HASH_SECRET`
   - `SELLER_PSEUDONYM_SECRET`
   - `METRICS_BEARER_TOKEN`
   - `DONUT_API_BASE_URL`
   - `DONUT_API_KEY`
   - `PUBLIC_APP_ORIGIN`
   - `NEXT_PUBLIC_API_ORIGIN`
   - `NEXT_PUBLIC_SITE_ORIGIN`
4. Run `pnpm railway:plan`. Review for unexpected deletes or variable changes. Do not use `--show-values` in shared logs.
5. Apply only the reviewed plan with `railway config apply`.

`DONUT_API_KEY` is referenced only by the collector. The API and web services do not receive it. `NEXT_PUBLIC_*` variables are deliberately public browser build settings and must never contain secrets.

The API runs advisory-lock-protected migrations before startup. The collector also verifies migrations on startup. Its Railway deployment health check is liveness rather than leader readiness so a rolling deployment cannot deadlock while the old replica still owns the collector lease; monitor `/health/ready` separately.

After provisioning PostgreSQL, configure Railway backups/PITR as available and the independent off-platform logical-backup procedure in `docs/backup-restore.md`. IaC does not replace restore drills.
