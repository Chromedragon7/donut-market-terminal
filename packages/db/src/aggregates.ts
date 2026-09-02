import type { AggregationRefreshInput, AggregationRefreshResult, Queryable } from "./types.js";

interface IntervalDefinition {
  readonly name: "minute" | "five_minute" | "hour" | "day" | "week";
  readonly durationSql: string;
  bucket(valueSql: string): string;
}

const INTERVALS: readonly IntervalDefinition[] = [
  { name: "minute", durationSql: "interval '1 minute'", bucket: (value) => utcTruncate("minute", value) },
  {
    name: "five_minute",
    durationSql: "interval '5 minutes'",
    bucket: (value) => `((date_trunc('hour', (${value}) AT TIME ZONE 'UTC')
      + ((extract(minute FROM (${value}) AT TIME ZONE 'UTC')::integer / 5)
        * interval '5 minutes')) AT TIME ZONE 'UTC')`,
  },
  { name: "hour", durationSql: "interval '1 hour'", bucket: (value) => utcTruncate("hour", value) },
  { name: "day", durationSql: "interval '1 day'", bucket: (value) => utcTruncate("day", value) },
  { name: "week", durationSql: "interval '1 week'", bucket: (value) => utcTruncate("week", value) },
];

function utcTruncate(unit: "minute" | "hour" | "day" | "week", valueSql: string): string {
  return `(date_trunc('${unit}', (${valueSql}) AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`;
}

/**
 * Recomputes every bucket touched by the requested range from immutable source
 * rows. All arithmetic stays PostgreSQL NUMERIC; no price crosses a JS float.
 * Callers that need atomicity with other writes should pass a transaction client.
 */
export async function refreshMarketAggregates(
  queryable: Queryable,
  input: AggregationRefreshInput,
): Promise<AggregationRefreshResult> {
  validateInput(input);
  // Repository callers execute this inside a transaction. Serialize each
  // source/version refresh so overlapping ranges cannot regress one another.
  await queryable.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`market-aggregates:${input.sourceId}:${input.computationVersion}`],
  );
  let saleCandles = 0;
  let askCandles = 0;
  for (const interval of INTERVALS) {
    const saleResult = await queryable.query(saleCandleSql(interval), saleParameters(input));
    saleCandles += saleResult.rowCount ?? 0;
    const askResult = await queryable.query(askCandleSql(interval), candleParameters(input));
    askCandles += askResult.rowCount ?? 0;
  }

  await queryable.query(
    `DELETE FROM market_summaries
     WHERE source_id = $1 AND computation_version = $2`,
    [input.sourceId, input.computationVersion],
  );
  const summaryResult = await queryable.query(summarySql(), [
    input.sourceId,
    input.computationVersion,
    input.computedAt,
    input.dedupeVersion,
  ]);
  return {
    saleCandles,
    askCandles,
    summaries: summaryResult.rowCount ?? 0,
  };
}

function candleParameters(input: AggregationRefreshInput): readonly unknown[] {
  return [
    input.sourceId,
    input.from,
    input.to,
    input.computationVersion,
    input.computedAt,
  ];
}

function saleParameters(input: AggregationRefreshInput): readonly unknown[] {
  return [...candleParameters(input), input.dedupeVersion];
}

function saleCandleSql(interval: IntervalDefinition): string {
  const bucket = interval.bucket("logical.source_sold_at");
  const rangeStart = interval.bucket("$2::timestamptz");
  return `WITH base AS (
    SELECT logical.id AS transaction_id, logical.source_id, logical.canonical_item_id,
           logical.item_variant_id, logical.source_sold_at, logical.unit_price,
           logical.total_price, logical.quantity, logical.confidence, logical.collision_state,
           ${bucket} AS bucket_start
    FROM logical_transactions logical
    JOIN item_variants variant ON variant.id = logical.item_variant_id
    WHERE logical.source_id = $1
      AND logical.dedupe_version = $6
      AND variant.identity_state <> 'excluded'
      AND logical.source_sold_at >= ${rangeStart}
      AND logical.source_sold_at < $3::timestamptz
  ), ranked AS (
    SELECT base.*,
           row_number() OVER (
             PARTITION BY source_id, item_variant_id, bucket_start
             ORDER BY unit_price, source_sold_at, transaction_id
           ) AS price_ordinal,
           count(*) OVER (
             PARTITION BY source_id, item_variant_id, bucket_start
           ) AS partition_count
    FROM base
  ), aggregated AS (
    SELECT source_id, canonical_item_id, item_variant_id, bucket_start,
           bucket_start + ${interval.durationSql} AS bucket_end,
           (array_agg(unit_price ORDER BY source_sold_at, transaction_id))[1] AS open_price,
           max(unit_price) AS high_price,
           min(unit_price) AS low_price,
           (array_agg(unit_price ORDER BY source_sold_at DESC, transaction_id DESC))[1] AS close_price,
           avg(unit_price) FILTER (
             WHERE price_ordinal IN ((partition_count + 1) / 2, (partition_count + 2) / 2)
           ) AS median_price,
           avg(unit_price) AS mean_price,
           sum(total_price) / NULLIF(sum(quantity), 0) AS quantity_weighted_mean,
           count(*) AS sample_count,
           sum(quantity) AS recorded_quantity,
           sum(total_price) AS recorded_turnover,
           CASE
             WHEN bool_or(confidence = 'low' OR collision_state <> 'none') THEN 'low'
             WHEN bool_or(confidence = 'medium') THEN 'medium'
             WHEN bool_and(confidence = 'high') THEN 'high'
             ELSE 'unknown'
           END AS confidence
    FROM ranked
    GROUP BY source_id, canonical_item_id, item_variant_id, bucket_start
  )
  INSERT INTO market_candles (
    source_id, canonical_item_id, item_variant_id, market_side, interval_name,
    bucket_start, bucket_end, open_price, high_price, low_price, close_price,
    median_price, mean_price, quantity_weighted_mean, sample_count,
    recorded_quantity, recorded_turnover, listing_count, listed_quantity,
    lowest_ask, highest_ask, confidence, completeness, computation_version, computed_at
  )
  SELECT aggregated.source_id, aggregated.canonical_item_id, aggregated.item_variant_id,
         'completed_sale', '${interval.name}', aggregated.bucket_start, aggregated.bucket_end,
         aggregated.open_price, aggregated.high_price, aggregated.low_price, aggregated.close_price,
         aggregated.median_price, aggregated.mean_price, aggregated.quantity_weighted_mean,
         aggregated.sample_count, aggregated.recorded_quantity, aggregated.recorded_turnover,
         NULL, NULL, NULL, NULL, aggregated.confidence,
         CASE WHEN EXISTS (
           SELECT 1 FROM data_gaps gap
           WHERE gap.source_id = aggregated.source_id
             AND gap.resource = 'auction_transactions'
             AND gap.status = 'open'
             AND gap.gap_start < aggregated.bucket_end
             AND COALESCE(gap.gap_end, 'infinity'::timestamptz) > aggregated.bucket_start
         ) THEN 'gapped' ELSE 'complete' END,
         $4, $5
  FROM aggregated
  ON CONFLICT (
    source_id, item_variant_id, market_side, interval_name, bucket_start, computation_version
  ) DO UPDATE SET
    canonical_item_id = EXCLUDED.canonical_item_id,
    bucket_end = EXCLUDED.bucket_end,
    open_price = EXCLUDED.open_price,
    high_price = EXCLUDED.high_price,
    low_price = EXCLUDED.low_price,
    close_price = EXCLUDED.close_price,
    median_price = EXCLUDED.median_price,
    mean_price = EXCLUDED.mean_price,
    quantity_weighted_mean = EXCLUDED.quantity_weighted_mean,
    sample_count = EXCLUDED.sample_count,
    recorded_quantity = EXCLUDED.recorded_quantity,
    recorded_turnover = EXCLUDED.recorded_turnover,
    listing_count = NULL,
    listed_quantity = NULL,
    lowest_ask = NULL,
    highest_ask = NULL,
    confidence = EXCLUDED.confidence,
    completeness = EXCLUDED.completeness,
    computed_at = EXCLUDED.computed_at,
    updated_at = clock_timestamp()`;
}

function askCandleSql(interval: IntervalDefinition): string {
  const bucket = interval.bucket("point_at");
  const rangeStart = interval.bucket("$2::timestamptz");
  return `WITH snapshot_points AS (
    SELECT snapshot.id AS snapshot_id, observation.source_id,
           observation.canonical_item_id, observation.item_variant_id,
           COALESCE(snapshot.completed_at, snapshot.observed_at) AS point_at,
           min(observation.unit_ask_price) AS lowest_ask,
           max(observation.unit_ask_price) AS highest_ask,
           count(*) AS listing_count,
           sum(observation.quantity) AS listed_quantity,
           sum(observation.total_ask_price) / NULLIF(sum(observation.quantity), 0)
             AS quantity_weighted_mean,
           CASE
             WHEN bool_or(observation.confidence = 'low') THEN 'low'
             WHEN bool_or(observation.confidence = 'medium') THEN 'medium'
             WHEN bool_and(observation.confidence = 'high') THEN 'high'
             ELSE 'unknown'
           END AS confidence,
           snapshot.status AS snapshot_status
    FROM listing_snapshots snapshot
    JOIN listing_observations observation ON observation.snapshot_id = snapshot.id
    JOIN item_variants variant ON variant.id = observation.item_variant_id
    WHERE observation.source_id = $1
      AND snapshot.status <> 'failed'
      AND variant.identity_state <> 'excluded'
      AND COALESCE(snapshot.completed_at, snapshot.observed_at) >= ${rangeStart}
      AND COALESCE(snapshot.completed_at, snapshot.observed_at) < $3::timestamptz
    GROUP BY snapshot.id, snapshot.completed_at, snapshot.observed_at, snapshot.status,
             observation.source_id, observation.canonical_item_id, observation.item_variant_id
  ), base AS (
    SELECT snapshot_points.*, ${bucket} AS bucket_start
    FROM snapshot_points
  ), ranked AS (
    SELECT base.*,
           row_number() OVER (
              PARTITION BY source_id, item_variant_id, bucket_start
              ORDER BY lowest_ask, point_at, snapshot_id
            ) AS price_ordinal,
           count(*) OVER (
              PARTITION BY source_id, item_variant_id, bucket_start
           ) AS partition_count
    FROM base
  ), aggregated AS (
    SELECT source_id, canonical_item_id, item_variant_id, bucket_start,
           bucket_start + ${interval.durationSql} AS bucket_end,
           (array_agg(lowest_ask ORDER BY point_at, snapshot_id))[1] AS open_price,
           max(lowest_ask) AS high_price,
           min(lowest_ask) AS low_price,
           (array_agg(lowest_ask ORDER BY point_at DESC, snapshot_id DESC))[1] AS close_price,
           avg(lowest_ask) FILTER (
              WHERE price_ordinal IN ((partition_count + 1) / 2, (partition_count + 2) / 2)
            ) AS median_price,
           avg(lowest_ask) AS mean_price,
           (array_agg(quantity_weighted_mean ORDER BY point_at DESC, snapshot_id DESC))[1]
             AS quantity_weighted_mean,
           count(*) AS sample_count,
           (array_agg(listing_count ORDER BY point_at DESC, snapshot_id DESC))[1] AS listing_count,
           (array_agg(listed_quantity ORDER BY point_at DESC, snapshot_id DESC))[1] AS listed_quantity,
           (array_agg(lowest_ask ORDER BY point_at DESC, snapshot_id DESC))[1] AS lowest_ask,
           (array_agg(highest_ask ORDER BY point_at DESC, snapshot_id DESC))[1] AS highest_ask,
           CASE
              WHEN bool_or(confidence = 'low') THEN 'low'
             WHEN bool_or(confidence = 'medium') THEN 'medium'
             WHEN bool_and(confidence = 'high') THEN 'high'
             ELSE 'unknown'
           END AS confidence,
           bool_or(snapshot_status <> 'complete') AS partial_snapshot
    FROM ranked
    GROUP BY source_id, canonical_item_id, item_variant_id, bucket_start
  )
  INSERT INTO market_candles (
    source_id, canonical_item_id, item_variant_id, market_side, interval_name,
    bucket_start, bucket_end, open_price, high_price, low_price, close_price,
    median_price, mean_price, quantity_weighted_mean, sample_count,
    recorded_quantity, recorded_turnover, listing_count, listed_quantity,
    lowest_ask, highest_ask, confidence, completeness, computation_version, computed_at
  )
  SELECT aggregated.source_id, aggregated.canonical_item_id, aggregated.item_variant_id,
         'active_ask', '${interval.name}', aggregated.bucket_start, aggregated.bucket_end,
          aggregated.open_price, aggregated.high_price, aggregated.low_price, aggregated.close_price,
          aggregated.median_price, aggregated.mean_price, aggregated.quantity_weighted_mean,
          aggregated.sample_count, 0, 0, aggregated.listing_count, aggregated.listed_quantity,
         aggregated.lowest_ask, aggregated.highest_ask, aggregated.confidence,
         CASE WHEN EXISTS (
           SELECT 1 FROM data_gaps gap
           WHERE gap.source_id = aggregated.source_id
             AND gap.resource = 'auction_listings'
             AND gap.status = 'open'
             AND gap.gap_start < aggregated.bucket_end
             AND COALESCE(gap.gap_end, 'infinity'::timestamptz) > aggregated.bucket_start
         ) THEN 'gapped'
         WHEN aggregated.partial_snapshot THEN 'partial'
         ELSE 'complete' END,
         $4, $5
  FROM aggregated
  ON CONFLICT (
    source_id, item_variant_id, market_side, interval_name, bucket_start, computation_version
  ) DO UPDATE SET
    canonical_item_id = EXCLUDED.canonical_item_id,
    bucket_end = EXCLUDED.bucket_end,
    open_price = EXCLUDED.open_price,
    high_price = EXCLUDED.high_price,
    low_price = EXCLUDED.low_price,
    close_price = EXCLUDED.close_price,
    median_price = EXCLUDED.median_price,
    mean_price = EXCLUDED.mean_price,
    quantity_weighted_mean = EXCLUDED.quantity_weighted_mean,
    sample_count = EXCLUDED.sample_count,
    recorded_quantity = 0,
    recorded_turnover = 0,
    listing_count = EXCLUDED.listing_count,
    listed_quantity = EXCLUDED.listed_quantity,
    lowest_ask = EXCLUDED.lowest_ask,
    highest_ask = EXCLUDED.highest_ask,
    confidence = EXCLUDED.confidence,
    completeness = EXCLUDED.completeness,
    computed_at = EXCLUDED.computed_at,
    updated_at = clock_timestamp()`;
}

function summarySql(): string {
  return `WITH candidates AS (
    SELECT catalog.canonical_item_id, catalog.item_variant_id
    FROM source_item_variants catalog
    JOIN item_variants variant ON variant.id = catalog.item_variant_id
    WHERE catalog.source_id = $1 AND variant.identity_state <> 'excluded'
  ), latest_snapshot AS (
    SELECT id, COALESCE(completed_at, observed_at) AS source_timestamp, status
    FROM listing_snapshots
    WHERE source_id = $1 AND status <> 'failed' AND search_text IS NULL
    ORDER BY observed_at DESC, id DESC
    LIMIT 1
  ), asks AS (
    SELECT observation.canonical_item_id, observation.item_variant_id,
           min(observation.unit_ask_price) AS lowest_ask,
           count(*) AS active_listing_count,
           sum(observation.quantity) AS active_listed_quantity,
           max(snapshot.source_timestamp) AS source_timestamp,
           CASE
             WHEN bool_or(observation.confidence = 'low') THEN 'low'
             WHEN bool_or(observation.confidence = 'medium') THEN 'medium'
             WHEN bool_and(observation.confidence = 'high') THEN 'high'
             ELSE 'unknown'
           END AS confidence
    FROM latest_snapshot snapshot
    JOIN listing_observations observation ON observation.snapshot_id = snapshot.id
    GROUP BY observation.canonical_item_id, observation.item_variant_id
  ), sale_base AS (
    SELECT logical.id AS transaction_id, logical.canonical_item_id, logical.item_variant_id,
           logical.source_sold_at, logical.unit_price, logical.total_price, logical.quantity,
           logical.confidence, logical.collision_state
    FROM logical_transactions logical
    JOIN item_variants variant ON variant.id = logical.item_variant_id
    WHERE logical.source_id = $1
      AND logical.dedupe_version = $4
      AND variant.identity_state <> 'excluded'
      AND logical.source_sold_at >= $3::timestamptz - interval '24 hours'
      AND logical.source_sold_at < $3::timestamptz + interval '1 millisecond'
  ), sale_ranked AS (
    SELECT sale_base.*,
           row_number() OVER (
             PARTITION BY item_variant_id ORDER BY unit_price, source_sold_at, transaction_id
           ) AS price_ordinal,
           count(*) OVER (PARTITION BY item_variant_id) AS partition_count
    FROM sale_base
  ), sales AS (
    SELECT canonical_item_id, item_variant_id,
           avg(unit_price) FILTER (
             WHERE price_ordinal IN ((partition_count + 1) / 2, (partition_count + 2) / 2)
           ) AS recent_sale_median,
           sum(total_price) / NULLIF(sum(quantity), 0) AS quantity_weighted_sale_price,
           (array_agg(unit_price ORDER BY source_sold_at DESC, transaction_id DESC))[1]
             AS most_recent_sale_price,
           count(*) AS sample_count,
           sum(quantity) AS recorded_quantity,
           sum(total_price) AS recorded_turnover,
           max(source_sold_at) AS source_timestamp,
           CASE
             WHEN bool_or(confidence = 'low' OR collision_state <> 'none') THEN 'low'
             WHEN bool_or(confidence = 'medium') THEN 'medium'
             WHEN bool_and(confidence = 'high') THEN 'high'
             ELSE 'unknown'
           END AS confidence
    FROM sale_ranked
    GROUP BY canonical_item_id, item_variant_id
  ), gap_state AS (
    SELECT bool_or(confidence = 'confirmed') AS confirmed,
           bool_or(confidence <> 'confirmed') AS possible
    FROM data_gaps
    WHERE source_id = $1 AND status = 'open'
      AND resource IN ('auction_transactions', 'auction_listings')
      AND gap_start < $3::timestamptz
      AND COALESCE(gap_end, 'infinity'::timestamptz) > $3::timestamptz - interval '24 hours'
  ), prepared AS (
    SELECT candidate.canonical_item_id, candidate.item_variant_id,
           ask.lowest_ask, sale.recent_sale_median, sale.quantity_weighted_sale_price,
           sale.most_recent_sale_price, COALESCE(sale.sample_count, 0) AS sample_count,
           COALESCE(sale.recorded_quantity, 0) AS recorded_quantity,
           COALESCE(sale.recorded_turnover, 0) AS recorded_turnover,
           COALESCE(ask.active_listing_count, 0) AS active_listing_count,
           COALESCE(ask.active_listed_quantity, 0) AS active_listed_quantity,
           GREATEST(sale.source_timestamp, snapshot.source_timestamp) AS source_timestamp,
           sale.source_timestamp AS sale_source_timestamp,
           snapshot.source_timestamp AS ask_source_timestamp,
           snapshot.status AS snapshot_status,
           CASE
             WHEN sale.confidence = 'low' OR ask.confidence = 'low' THEN 'low'
             WHEN sale.confidence = 'medium' OR ask.confidence = 'medium' THEN 'medium'
             WHEN sale.confidence = 'high' OR ask.confidence = 'high' THEN 'high'
             ELSE 'unknown'
           END AS confidence,
           CASE
             WHEN COALESCE(gap.confirmed, false) OR COALESCE(gap.possible, false) THEN 'gapped'
              WHEN snapshot.id IS NULL AND sale.item_variant_id IS NULL THEN 'unknown'
              WHEN snapshot.id IS NULL OR snapshot.status = 'partial' THEN 'partial'
              ELSE 'complete'
           END AS completeness,
           CASE
             WHEN COALESCE(gap.confirmed, false) THEN 'confirmed'
             WHEN COALESCE(gap.possible, false) THEN 'possible'
             ELSE 'none'
           END AS gap_status
    FROM candidates candidate
    LEFT JOIN sales sale ON sale.item_variant_id = candidate.item_variant_id
    LEFT JOIN asks ask ON ask.item_variant_id = candidate.item_variant_id
    LEFT JOIN latest_snapshot snapshot ON true
    CROSS JOIN gap_state gap
  )
  INSERT INTO market_summaries (
    id, source_id, canonical_item_id, item_variant_id, window_name,
    window_start, window_end, lowest_ask, recent_sale_median,
    quantity_weighted_sale_price, most_recent_sale_price, sample_count,
    recorded_quantity, recorded_turnover, active_listing_count,
    active_listed_quantity, observed_at, source_timestamp, confidence,
    freshness, completeness, gap_status, computation_version, metadata,
    created_at, updated_at
  )
  SELECT md5($1::text || ':' || prepared.item_variant_id::text || ':rolling_24h:' || $2)::uuid,
         $1, prepared.canonical_item_id, prepared.item_variant_id, 'rolling_24h',
         $3::timestamptz - interval '24 hours', $3, prepared.lowest_ask,
         prepared.recent_sale_median, prepared.quantity_weighted_sale_price,
         prepared.most_recent_sale_price, prepared.sample_count,
         prepared.recorded_quantity, prepared.recorded_turnover,
         prepared.active_listing_count, prepared.active_listed_quantity,
         $3, prepared.source_timestamp, prepared.confidence,
         CASE
           WHEN prepared.source_timestamp IS NULL THEN 'unavailable'
           WHEN $3::timestamptz - prepared.source_timestamp <= interval '2 minutes' THEN 'live'
           WHEN $3::timestamptz - prepared.source_timestamp <= interval '15 minutes' THEN 'recent'
           WHEN $3::timestamptz - prepared.source_timestamp <= interval '1 hour' THEN 'aging'
           ELSE 'stale'
         END,
         prepared.completeness, prepared.gap_status, $2,
          jsonb_build_object(
            'recordedVolumeOnly', true,
            'activeAskFromLatestSnapshot', true,
            'feesKnown', false,
            'dedupeVersion', $4,
            'saleSourceTimestamp', prepared.sale_source_timestamp,
            'askSourceTimestamp', prepared.ask_source_timestamp,
            'askSnapshotStatus', prepared.snapshot_status,
            'askSnapshotScope', 'unfiltered'
          ),
         clock_timestamp(), clock_timestamp()
  FROM prepared`;
}

function validateInput(input: AggregationRefreshInput): void {
  if (input.sourceId.trim().length === 0) throw new TypeError("Aggregation sourceId is required");
  if (input.computationVersion.trim().length === 0) {
    throw new TypeError("Aggregation computationVersion is required");
  }
  if (input.dedupeVersion.trim().length === 0) {
    throw new TypeError("Aggregation dedupeVersion is required");
  }
  if (!Number.isFinite(input.from.valueOf()) || !Number.isFinite(input.to.valueOf())) {
    throw new RangeError("Aggregation range must contain valid dates");
  }
  if (input.to <= input.from) throw new RangeError("Aggregation range end must be after its start");
  if (!Number.isFinite(input.computedAt.valueOf())) {
    throw new RangeError("Aggregation computedAt must be a valid date");
  }
}
