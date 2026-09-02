# Backup and restoration

Production requires three layers: provider snapshots/PITR where available, scheduled logical PostgreSQL backups, and encrypted off-platform copies. Railway volume snapshots alone are not disaster recovery.

The repository does not currently provision a backup job, backup catalog, object archive, or Railway backup/PITR policy. These are production setup gates, not shipped automation. Size them with [Storage growth and retention planning](storage-growth.md).

Backups must cover raw observations, normalized records, gaps, source/collection state, users, revocable sessions/tokens, watchlists, alerts, dashboards, feature flags, and outbox cursors. Record backup time, schema version, size, checksum, encryption/key reference, retention expiry, and verification result. Alert on failed or overdue backups.

Restore drill:

1. Provision an isolated database and restrict network access.
2. Verify checksum and decrypt without exposing the key in logs.
3. Restore the logical backup, apply only forward-compatible migrations, and run integrity/count checks.
4. Confirm raw-to-normalized provenance links, gap records, newest/oldest timestamps, and user ownership.
5. Start API/collector in read-only or paused mode, confirm readiness and cursor behavior, then resume collection without overwriting the known gap.
6. Record recovery point/time and destroy the isolated restore after approval.

Follow current [Railway PostgreSQL backup/restore guidance](https://docs.railway.com/guides/postgres-backups-restores), while retaining an off-platform recovery path.
