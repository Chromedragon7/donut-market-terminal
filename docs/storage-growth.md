# Storage growth and retention planning

“Indefinite retention” is an operating policy, not a finite volume size. Capacity must be forecast from measured production growth, reviewed regularly, and paired with an archive/restore path before a volume approaches its limit.

No live transaction rate, listing rate, record size, database growth, or backup size has been measured for this mirror yet. Do not choose a Railway plan from sample numbers.

## Measurements

Measure over at least the 48–72-hour API study and then over a representative week:

- `T`: new logical completed transactions per day.
- `L`: retained listing observations per day.
- `B_t`: average raw transaction-record bytes.
- `B_l`: average raw listing-record bytes.
- `N_t` and `N_l`: average normalized observation/dedupe bytes, including row and TOAST overhead.
- `R`: daily request/run/health/gap/outbox overhead.
- `I`: index overhead as a fraction of table/TOAST bytes.
- `A`: aggregate overhead per day, or an aggregate-over-history fraction if it is stable.
- `M_b`: backup multiplication, including retained logical backups, snapshots, and PITR/WAL.
- `D`: retained days for the planning horizon. Raw evidence itself has no deletion horizon.

Use physical database growth, not only JSON length. `raw_payloads` is content-addressed by full response body, while individual observation rows can also contain raw-record JSON; compression and duplicate response bodies therefore make a simple record-count estimate imperfect.

Useful read-only PostgreSQL measurements include:

```sql
SELECT date_trunc('day', source_sold_at) AS day, count(*)
FROM logical_transactions
GROUP BY 1 ORDER BY 1;

SELECT date_trunc('day', observed_at) AS day, count(*)
FROM listing_observations
GROUP BY 1 ORDER BY 1;

SELECT count(*) AS payloads, avg(byte_length) AS average_response_bytes,
       sum(byte_length) AS retained_response_bytes
FROM raw_payloads;

SELECT relname,
       pg_size_pretty(pg_table_size(relid)) AS table_and_toast,
       pg_size_pretty(pg_indexes_size(relid)) AS indexes,
       pg_size_pretty(pg_total_relation_size(relid)) AS total
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC;
```

Capture the same relation-size query at fixed times. The delta is more reliable than estimating PostgreSQL row headers by hand. Measure actual compressed logical-backup files and Railway snapshot/PITR consumption separately.

## Planning formula

For a first transparent estimate:

```text
raw_per_day        = (T × B_t) + (L × B_l)
normalized_per_day = (T × N_t) + (L × N_l)
base_per_day       = raw_per_day + normalized_per_day + R + A
primary_for_D      = D × base_per_day × (1 + I)
backup_for_D       = primary_for_D × M_b
accounted_for_D    = primary_for_D + backup_for_D
```

When aggregate bytes are modeled as a fraction instead, remove `A` from `base_per_day` and multiply `primary_for_D` by `(1 + aggregate_fraction)`. Keep the worksheet's units and inclusion choices explicit so index or backup bytes are not counted twice.

Report at least daily, 30-day, and 365-day growth plus current free space and days-to-threshold under median and high observed load. Add operational headroom based on measured vacuum, migration, restore, and index-build requirements; do not hide that margin inside the observed rate.

## Database lifecycle

Current migrations use bounded query indexes and BRIN indexes for time-ordered observation tables, but the tables are not partitioned. There is no object-storage archive writer, archive catalog, or restore tool. Before retained history becomes operationally large:

1. Benchmark queries and backup/restore duration using production-shaped data.
2. Introduce time partitions with a forward-compatible migration and a rollback plan.
3. Keep recent high-resolution aggregates and progressively coarser long-range aggregates without deleting raw evidence.
4. If object archival is needed, use immutable encrypted objects plus a catalog containing source, time bounds, schema/version, checksum, row counts, and restoration instructions.
5. Restore an archive into an isolated database and verify raw-to-normalized provenance before moving any production partition.

Partitioning is management, not retention: dropping old partitions would violate the current history requirement. Archive portability must prevent permanent evidence from becoming irreversibly tied to Railway or any single object provider.

## Capacity and alerts

Alert on database utilization and projected days-to-capacity well before emergency levels, as well as failed writes, autovacuum lag, index growth, backup age/size, and restore-drill age. Recalculate after changing poll rates, listing coverage, schema, indexes, compression, aggregation cadence, or backup retention.

Choose a Railway compute/database/volume plan only after these measurements and re-check current [Railway pricing and limits](https://docs.railway.com/pricing/plans). Provider snapshots/PITR and off-platform logical copies are additional capacity, not substitutes for the primary forecast.
