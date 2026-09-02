CREATE OR REPLACE FUNCTION donut_numeric_is_finite(value numeric)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT value::text NOT IN ('NaN', 'Infinity', '-Infinity')
$$;

CREATE TABLE sources (
  id uuid PRIMARY KEY,
  source_key text NOT NULL UNIQUE CHECK (source_key ~ '^[a-z0-9][a-z0-9._-]{1,127}$'),
  source_type text NOT NULL,
  display_name text NOT NULL,
  endpoint_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  trust_level text NOT NULL DEFAULT 'unverified'
    CHECK (trust_level IN ('unverified', 'community', 'compatible', 'authoritative')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

COMMENT ON COLUMN sources.endpoint_metadata IS
  'Non-secret endpoint identity only. Authentication headers and tokens are forbidden.';

CREATE TABLE raw_payloads (
  sha256 text PRIMARY KEY CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  body bytea NOT NULL,
  byte_length bigint NOT NULL CHECK (byte_length >= 0),
  content_type text,
  content_encoding text,
  first_observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT raw_payload_length_matches CHECK (octet_length(body) = byte_length)
);

COMMENT ON TABLE raw_payloads IS
  'Content-addressed exact response evidence. Rows are immutable and deduplicated by SHA-256.';

CREATE TABLE collection_runs (
  id uuid PRIMARY KEY,
  source_id uuid NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  resource text NOT NULL
    CHECK (resource IN ('auction_transactions', 'auction_listings', 'metadata', 'backfill')),
  mode text NOT NULL CHECK (mode IN ('one_shot', 'continuous', 'validation', 'backfill')),
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded', 'partial', 'failed', 'cancelled')),
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  collector_version text NOT NULL,
  provider_version text NOT NULL,
  validation_version text NOT NULL,
  normalization_version text NOT NULL,
  dedupe_version text NOT NULL,
  schedule_version text NOT NULL,
  instance_id text NOT NULL,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  response_count integer NOT NULL DEFAULT 0 CHECK (response_count >= 0),
  received_count integer NOT NULL DEFAULT 0 CHECK (received_count >= 0),
  new_count integer NOT NULL DEFAULT 0 CHECK (new_count >= 0),
  duplicate_count integer NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  invalid_count integer NOT NULL DEFAULT 0 CHECK (invalid_count >= 0),
  error_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  rate_limit_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  latency_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  continuation jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT collection_run_completion_consistent CHECK (
    (status = 'running' AND completed_at IS NULL)
    OR (status <> 'running' AND completed_at IS NOT NULL)
  ),
  UNIQUE (id, source_id)
);

CREATE INDEX collection_runs_source_resource_started_idx
  ON collection_runs (source_id, resource, started_at DESC);
CREATE INDEX collection_runs_incomplete_idx
  ON collection_runs (started_at) WHERE status = 'running';

CREATE TABLE source_requests (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES collection_runs(id) ON DELETE RESTRICT,
  source_id uuid NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  resource text NOT NULL
    CHECK (resource IN ('auction_transactions', 'auction_listings', 'metadata', 'backfill')),
  page integer CHECK (page IS NULL OR page >= 1),
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  requested_at timestamptz NOT NULL,
  responded_at timestamptz,
  latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
  http_status integer CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  request_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_payload_sha256 text REFERENCES raw_payloads(sha256) ON DELETE RESTRICT,
  response_bytes bigint CHECK (response_bytes IS NULL OR response_bytes >= 0),
  validation_status text NOT NULL
    CHECK (validation_status IN ('not_attempted', 'valid', 'partially_valid', 'invalid')),
  completeness_status text NOT NULL
    CHECK (completeness_status IN ('unknown', 'complete', 'partial', 'empty')),
  error_code text,
  error_message text,
  rate_limit_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (run_id, resource, page, attempt),
  UNIQUE (id, run_id, source_id),
  CONSTRAINT source_request_run_source_fk FOREIGN KEY (run_id, source_id)
    REFERENCES collection_runs(id, source_id) ON DELETE RESTRICT,
  CONSTRAINT source_request_timing CHECK (
    responded_at IS NULL OR responded_at >= requested_at
  )
);

COMMENT ON COLUMN source_requests.request_metadata IS
  'Sanitized request metadata. Authorization and cookie material are forbidden.';

CREATE INDEX source_requests_source_resource_time_idx
  ON source_requests (source_id, resource, requested_at DESC);
CREATE INDEX source_requests_run_idx ON source_requests (run_id, requested_at);
CREATE INDEX source_requests_errors_idx
  ON source_requests (source_id, requested_at DESC)
  WHERE error_code IS NOT NULL OR http_status >= 400;

CREATE TABLE canonical_items (
  id uuid PRIMARY KEY,
  minecraft_id text NOT NULL UNIQUE,
  namespace text NOT NULL,
  item_path text NOT NULL,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT canonical_item_id_shape CHECK (minecraft_id = namespace || ':' || item_path)
);

CREATE INDEX canonical_items_display_name_idx ON canonical_items (lower(display_name));

CREATE TABLE item_variants (
  id uuid PRIMARY KEY,
  canonical_item_id uuid NOT NULL REFERENCES canonical_items(id) ON DELETE RESTRICT,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  fingerprint_version text NOT NULL,
  canonical_metadata jsonb NOT NULL,
  identity_state text NOT NULL
    CHECK (identity_state IN (
      'exact', 'strong', 'broad', 'incomplete', 'ambiguous', 'unclassified', 'excluded'
    )),
  completeness jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (fingerprint_version, fingerprint),
  UNIQUE (id, canonical_item_id)
);

CREATE INDEX item_variants_item_idx ON item_variants (canonical_item_id, identity_state);
CREATE INDEX item_variants_metadata_gin_idx ON item_variants USING gin (canonical_metadata);

CREATE TABLE sellers (
  id uuid PRIMARY KEY,
  source_id uuid NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  source_seller_id text NOT NULL,
  current_name text,
  visibility_policy text NOT NULL DEFAULT 'owner_full'
    CHECK (visibility_policy IN ('owner_full', 'name_only', 'pseudonymized', 'hidden')),
  first_observed_at timestamptz NOT NULL,
  last_observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (source_id, source_seller_id),
  UNIQUE (id, source_id),
  CONSTRAINT seller_observation_order CHECK (last_observed_at >= first_observed_at)
);

COMMENT ON TABLE sellers IS
  'Private source identity. Public APIs must apply server-side seller visibility policy.';

CREATE TABLE logical_transactions (
  id uuid PRIMARY KEY,
  source_id uuid NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  collision_ordinal integer NOT NULL CHECK (collision_ordinal >= 1),
  dedupe_version text NOT NULL,
  source_sold_at timestamptz NOT NULL,
  canonical_item_id uuid NOT NULL REFERENCES canonical_items(id) ON DELETE RESTRICT,
  item_variant_id uuid NOT NULL REFERENCES item_variants(id) ON DELETE RESTRICT,
  seller_id uuid REFERENCES sellers(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  total_price numeric NOT NULL CHECK (donut_numeric_is_finite(total_price) AND total_price >= 0),
  total_price_source_text text NOT NULL,
  unit_price numeric NOT NULL CHECK (donut_numeric_is_finite(unit_price) AND unit_price >= 0),
  unit_price_exact_text text NOT NULL,
  unit_price_numerator numeric NOT NULL CHECK (donut_numeric_is_finite(unit_price_numerator) AND unit_price_numerator >= 0 AND trunc(unit_price_numerator) = unit_price_numerator),
  unit_price_denominator numeric NOT NULL CHECK (donut_numeric_is_finite(unit_price_denominator) AND unit_price_denominator > 0 AND trunc(unit_price_denominator) = unit_price_denominator),
  first_observed_at timestamptz NOT NULL,
  last_observed_at timestamptz NOT NULL,
  observation_count bigint NOT NULL DEFAULT 1 CHECK (observation_count >= 1),
  collision_state text NOT NULL DEFAULT 'none'
    CHECK (collision_state IN ('none', 'possible', 'ambiguous', 'confirmed_multiplicity')),
  confidence text NOT NULL CHECK (confidence IN ('high', 'medium', 'low', 'unknown')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (source_id, fingerprint, collision_ordinal, dedupe_version),
  CONSTRAINT logical_transaction_variant_item_fk
    FOREIGN KEY (item_variant_id, canonical_item_id)
    REFERENCES item_variants(id, canonical_item_id) ON DELETE RESTRICT,
  CONSTRAINT logical_transaction_seller_source_fk
    FOREIGN KEY (seller_id, source_id)
    REFERENCES sellers(id, source_id) ON DELETE RESTRICT,
  CONSTRAINT logical_transaction_observation_order CHECK (last_observed_at >= first_observed_at)
);

CREATE INDEX logical_transactions_variant_sold_idx
  ON logical_transactions (item_variant_id, source_sold_at DESC);
CREATE INDEX logical_transactions_item_sold_idx
  ON logical_transactions (canonical_item_id, source_sold_at DESC);
CREATE INDEX logical_transactions_source_sold_idx
  ON logical_transactions (source_id, source_sold_at DESC);
CREATE INDEX logical_transactions_fingerprint_idx
  ON logical_transactions (source_id, fingerprint);

CREATE TABLE transaction_observations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES source_requests(id) ON DELETE RESTRICT,
  run_id uuid NOT NULL REFERENCES collection_runs(id) ON DELETE RESTRICT,
  source_id uuid NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  record_index integer NOT NULL CHECK (record_index >= 0),
  page integer NOT NULL CHECK (page >= 1),
  page_position integer NOT NULL CHECK (page_position >= 0),
  observed_at timestamptz NOT NULL,
  source_sold_at timestamptz NOT NULL,
  canonical_item_id uuid NOT NULL REFERENCES canonical_items(id) ON DELETE RESTRICT,
  item_variant_id uuid NOT NULL REFERENCES item_variants(id) ON DELETE RESTRICT,
  seller_id uuid REFERENCES sellers(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  total_price numeric NOT NULL CHECK (donut_numeric_is_finite(total_price) AND total_price >= 0),
  total_price_source_text text NOT NULL,
  unit_price numeric NOT NULL CHECK (donut_numeric_is_finite(unit_price) AND unit_price >= 0),
  unit_price_exact_text text NOT NULL,
  unit_price_numerator numeric NOT NULL CHECK (donut_numeric_is_finite(unit_price_numerator) AND unit_price_numerator >= 0 AND trunc(unit_price_numerator) = unit_price_numerator),
  unit_price_denominator numeric NOT NULL CHECK (donut_numeric_is_finite(unit_price_denominator) AND unit_price_denominator > 0 AND trunc(unit_price_denominator) = unit_price_denominator),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  occurrence_ordinal integer NOT NULL CHECK (occurrence_ordinal >= 1),
  fingerprint_version text NOT NULL,
  normalization_version text NOT NULL,
  validation_status text NOT NULL CHECK (validation_status IN ('valid', 'quarantined')),
  confidence text NOT NULL CHECK (confidence IN ('high', 'medium', 'low', 'unknown')),
  flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_record jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (request_id, record_index),
  CONSTRAINT transaction_observation_request_provenance_fk
    FOREIGN KEY (request_id, run_id, source_id)
    REFERENCES source_requests(id, run_id, source_id) ON DELETE RESTRICT,
  CONSTRAINT transaction_observation_variant_item_fk
    FOREIGN KEY (item_variant_id, canonical_item_id)
    REFERENCES item_variants(id, canonical_item_id) ON DELETE RESTRICT,
  CONSTRAINT transaction_observation_seller_source_fk
    FOREIGN KEY (seller_id, source_id)
    REFERENCES sellers(id, source_id) ON DELETE RESTRICT
);

CREATE INDEX transaction_observations_variant_time_idx
  ON transaction_observations (item_variant_id, source_sold_at DESC);
CREATE INDEX transaction_observations_run_idx ON transaction_observations (run_id, page, page_position);
CREATE INDEX transaction_observations_fingerprint_idx
  ON transaction_observations (source_id, fingerprint, occurrence_ordinal);
CREATE INDEX transaction_observations_observed_brin_idx
  ON transaction_observations USING brin (observed_at);

CREATE TABLE quarantined_records (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES source_requests(id) ON DELETE RESTRICT,
  run_id uuid NOT NULL REFERENCES collection_runs(id) ON DELETE RESTRICT,
  source_id uuid NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  resource text NOT NULL,
  record_index integer NOT NULL CHECK (record_index >= 0),
  page integer CHECK (page IS NULL OR page >= 1),
  observed_at timestamptz NOT NULL,
  raw_record jsonb,
  validation_errors jsonb NOT NULL,
  validation_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (request_id, record_index),
  CONSTRAINT quarantined_record_request_provenance_fk
    FOREIGN KEY (request_id, run_id, source_id)
    REFERENCES source_requests(id, run_id, source_id) ON DELETE RESTRICT
);

CREATE INDEX quarantined_records_run_idx ON quarantined_records (run_id, page, record_index);
CREATE INDEX quarantined_records_time_brin_idx ON quarantined_records USING brin (observed_at);

CREATE TABLE transaction_dedupe_decisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  observation_id bigint NOT NULL REFERENCES transaction_observations(id) ON DELETE RESTRICT,
  logical_transaction_id uuid REFERENCES logical_transactions(id) ON DELETE RESTRICT,
  algorithm_version text NOT NULL,
  decision text NOT NULL
    CHECK (decision IN ('new', 'repeat', 'possible_collision', 'quarantined', 'unresolved')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (observation_id, algorithm_version)
);

CREATE INDEX transaction_dedupe_logical_idx
  ON transaction_dedupe_decisions (logical_transaction_id, decided_at DESC);

CREATE TABLE listing_snapshots (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES collection_runs(id) ON DELETE RESTRICT,
  source_id uuid NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  observed_at timestamptz NOT NULL,
  completed_at timestamptz,
  status text NOT NULL CHECK (status IN ('complete', 'partial', 'failed')),
  search_text text,
  sort_mode text,
  first_page integer NOT NULL CHECK (first_page >= 1),
  last_page integer CHECK (last_page IS NULL OR last_page >= first_page),
  positions_observed integer NOT NULL CHECK (positions_observed >= 0),
  nonnull_listings integer NOT NULL CHECK (nonnull_listings >= 0),
  consistency text NOT NULL CHECK (consistency IN ('consistent', 'changed_during_scan', 'unknown')),
  fingerprint_version text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT listing_snapshot_completion CHECK (
    (status = 'failed') OR completed_at IS NOT NULL
  ),
  CONSTRAINT listing_snapshot_run_source_fk FOREIGN KEY (run_id, source_id)
    REFERENCES collection_runs(id, source_id) ON DELETE RESTRICT,
  UNIQUE (id, run_id, source_id)
);

CREATE INDEX listing_snapshots_source_time_idx
  ON listing_snapshots (source_id, observed_at DESC);

CREATE TABLE listing_observations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES source_requests(id) ON DELETE RESTRICT,
  snapshot_id uuid NOT NULL REFERENCES listing_snapshots(id) ON DELETE RESTRICT,
  run_id uuid NOT NULL REFERENCES collection_runs(id) ON DELETE RESTRICT,
  source_id uuid NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  record_index integer NOT NULL CHECK (record_index >= 0),
  page integer NOT NULL CHECK (page >= 1),
  page_position integer NOT NULL CHECK (page_position >= 0),
  observed_at timestamptz NOT NULL,
  canonical_item_id uuid NOT NULL REFERENCES canonical_items(id) ON DELETE RESTRICT,
  item_variant_id uuid NOT NULL REFERENCES item_variants(id) ON DELETE RESTRICT,
  seller_id uuid REFERENCES sellers(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  total_ask_price numeric NOT NULL CHECK (donut_numeric_is_finite(total_ask_price) AND total_ask_price >= 0),
  total_ask_price_source_text text NOT NULL,
  unit_ask_price numeric NOT NULL CHECK (donut_numeric_is_finite(unit_ask_price) AND unit_ask_price >= 0),
  unit_ask_price_exact_text text NOT NULL,
  unit_ask_price_numerator numeric NOT NULL CHECK (donut_numeric_is_finite(unit_ask_price_numerator) AND unit_ask_price_numerator >= 0 AND trunc(unit_ask_price_numerator) = unit_ask_price_numerator),
  unit_ask_price_denominator numeric NOT NULL CHECK (donut_numeric_is_finite(unit_ask_price_denominator) AND unit_ask_price_denominator > 0 AND trunc(unit_ask_price_denominator) = unit_ask_price_denominator),
  remaining_time_text text,
  approximate_expires_at timestamptz,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  fingerprint_version text NOT NULL,
  confidence text NOT NULL CHECK (confidence IN ('high', 'medium', 'low', 'unknown')),
  flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_record jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (request_id, record_index),
  CONSTRAINT listing_observation_request_provenance_fk
    FOREIGN KEY (request_id, run_id, source_id)
    REFERENCES source_requests(id, run_id, source_id) ON DELETE RESTRICT,
  CONSTRAINT listing_observation_snapshot_provenance_fk
    FOREIGN KEY (snapshot_id, run_id, source_id)
    REFERENCES listing_snapshots(id, run_id, source_id) ON DELETE RESTRICT,
  CONSTRAINT listing_observation_variant_item_fk
    FOREIGN KEY (item_variant_id, canonical_item_id)
    REFERENCES item_variants(id, canonical_item_id) ON DELETE RESTRICT,
  CONSTRAINT listing_observation_seller_source_fk
    FOREIGN KEY (seller_id, source_id)
    REFERENCES sellers(id, source_id) ON DELETE RESTRICT
);

CREATE INDEX listing_observations_variant_time_idx
  ON listing_observations (item_variant_id, observed_at DESC);
CREATE INDEX listing_observations_snapshot_idx
  ON listing_observations (snapshot_id, page, page_position);
CREATE INDEX listing_observations_fingerprint_idx
  ON listing_observations (source_id, fingerprint, observed_at DESC);
CREATE INDEX listing_observations_observed_brin_idx
  ON listing_observations USING brin (observed_at);

CREATE TABLE data_gaps (
  id uuid PRIMARY KEY,
  source_id uuid NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  resource text NOT NULL
    CHECK (resource IN ('auction_transactions', 'auction_listings', 'metadata', 'backfill')),
  gap_start timestamptz NOT NULL,
  gap_end timestamptz,
  detected_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'superseded')),
  reason text NOT NULL,
  confidence text NOT NULL CHECK (confidence IN ('confirmed', 'likely', 'possible', 'unknown')),
  detection_version text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_run_id uuid REFERENCES collection_runs(id) ON DELETE RESTRICT,
  last_run_id uuid REFERENCES collection_runs(id) ON DELETE RESTRICT,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT data_gap_order CHECK (gap_end IS NULL OR gap_end >= gap_start),
  CONSTRAINT data_gap_first_run_source_fk FOREIGN KEY (first_run_id, source_id)
    REFERENCES collection_runs(id, source_id) ON DELETE RESTRICT,
  CONSTRAINT data_gap_last_run_source_fk FOREIGN KEY (last_run_id, source_id)
    REFERENCES collection_runs(id, source_id) ON DELETE RESTRICT
);

CREATE INDEX data_gaps_open_idx
  ON data_gaps (source_id, resource, gap_start DESC) WHERE status = 'open';

CREATE TABLE source_health_samples (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id uuid NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  observed_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN (
    'healthy', 'delayed', 'throttled', 'degraded', 'offline', 'unauthorized', 'unknown'
  )),
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text,
  run_id uuid REFERENCES collection_runs(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT source_health_run_source_fk FOREIGN KEY (run_id, source_id)
    REFERENCES collection_runs(id, source_id) ON DELETE RESTRICT
);

CREATE INDEX source_health_latest_idx
  ON source_health_samples (source_id, observed_at DESC);
CREATE INDEX source_health_time_brin_idx
  ON source_health_samples USING brin (observed_at);

CREATE TABLE collector_leases (
  lease_key text PRIMARY KEY,
  owner_id text NOT NULL,
  fencing_token bigint NOT NULL CHECK (fencing_token >= 1),
  acquired_at timestamptz NOT NULL,
  heartbeat_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT collector_lease_expiration CHECK (expires_at > heartbeat_at)
);

CREATE INDEX collector_leases_expiry_idx ON collector_leases (expires_at);

CREATE TABLE collector_checkpoints (
  source_id uuid NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  resource text NOT NULL,
  checkpoint_version text NOT NULL,
  cursor_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  next_run_at timestamptz,
  last_success_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (source_id, resource)
);

CREATE OR REPLACE FUNCTION reject_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'evidence table % is append-only', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER raw_payloads_append_only
  BEFORE UPDATE OR DELETE ON raw_payloads
  FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();
CREATE TRIGGER source_requests_append_only
  BEFORE UPDATE OR DELETE ON source_requests
  FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();
CREATE TRIGGER transaction_observations_append_only
  BEFORE UPDATE OR DELETE ON transaction_observations
  FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();
CREATE TRIGGER transaction_dedupe_decisions_append_only
  BEFORE UPDATE OR DELETE ON transaction_dedupe_decisions
  FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();
CREATE TRIGGER quarantined_records_append_only
  BEFORE UPDATE OR DELETE ON quarantined_records
  FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();
CREATE TRIGGER listing_observations_append_only
  BEFORE UPDATE OR DELETE ON listing_observations
  FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();
CREATE TRIGGER listing_snapshots_append_only
  BEFORE UPDATE OR DELETE ON listing_snapshots
  FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();
CREATE TRIGGER source_health_samples_append_only
  BEFORE UPDATE OR DELETE ON source_health_samples
  FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();
