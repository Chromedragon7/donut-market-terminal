CREATE TABLE source_item_variants (
  source_id uuid NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  canonical_item_id uuid NOT NULL REFERENCES canonical_items(id) ON DELETE RESTRICT,
  item_variant_id uuid NOT NULL REFERENCES item_variants(id) ON DELETE RESTRICT,
  first_observed_at timestamptz NOT NULL,
  last_observed_at timestamptz NOT NULL,
  PRIMARY KEY (source_id, item_variant_id),
  CONSTRAINT source_item_variant_item_fk
    FOREIGN KEY (item_variant_id, canonical_item_id)
    REFERENCES item_variants(id, canonical_item_id) ON DELETE RESTRICT,
  CONSTRAINT source_item_variant_observation_order CHECK (last_observed_at >= first_observed_at)
);

CREATE INDEX source_item_variants_item_idx
  ON source_item_variants (canonical_item_id, item_variant_id);

INSERT INTO source_item_variants (
  source_id, canonical_item_id, item_variant_id, first_observed_at, last_observed_at
)
SELECT source_id, canonical_item_id, item_variant_id,
       min(first_observed_at), max(last_observed_at)
FROM logical_transactions
GROUP BY source_id, canonical_item_id, item_variant_id
ON CONFLICT (source_id, item_variant_id) DO NOTHING;

INSERT INTO source_item_variants (
  source_id, canonical_item_id, item_variant_id, first_observed_at, last_observed_at
)
SELECT source_id, canonical_item_id, item_variant_id,
       min(observed_at), max(observed_at)
FROM listing_observations
GROUP BY source_id, canonical_item_id, item_variant_id
ON CONFLICT (source_id, item_variant_id) DO UPDATE SET
  first_observed_at = LEAST(source_item_variants.first_observed_at, EXCLUDED.first_observed_at),
  last_observed_at = GREATEST(source_item_variants.last_observed_at, EXCLUDED.last_observed_at);

CREATE TABLE market_candles (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id uuid NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  canonical_item_id uuid NOT NULL REFERENCES canonical_items(id) ON DELETE RESTRICT,
  item_variant_id uuid NOT NULL REFERENCES item_variants(id) ON DELETE RESTRICT,
  market_side text NOT NULL CHECK (market_side IN ('completed_sale', 'active_ask')),
  interval_name text NOT NULL CHECK (interval_name IN ('minute', 'five_minute', 'hour', 'day', 'week')),
  bucket_start timestamptz NOT NULL,
  bucket_end timestamptz NOT NULL,
  open_price numeric CHECK (open_price IS NULL OR (donut_numeric_is_finite(open_price) AND open_price >= 0)),
  high_price numeric CHECK (high_price IS NULL OR (donut_numeric_is_finite(high_price) AND high_price >= 0)),
  low_price numeric CHECK (low_price IS NULL OR (donut_numeric_is_finite(low_price) AND low_price >= 0)),
  close_price numeric CHECK (close_price IS NULL OR (donut_numeric_is_finite(close_price) AND close_price >= 0)),
  median_price numeric CHECK (median_price IS NULL OR (donut_numeric_is_finite(median_price) AND median_price >= 0)),
  mean_price numeric CHECK (mean_price IS NULL OR (donut_numeric_is_finite(mean_price) AND mean_price >= 0)),
  quantity_weighted_mean numeric CHECK (quantity_weighted_mean IS NULL OR (donut_numeric_is_finite(quantity_weighted_mean) AND quantity_weighted_mean >= 0)),
  sample_count bigint NOT NULL DEFAULT 0 CHECK (sample_count >= 0),
  recorded_quantity numeric NOT NULL DEFAULT 0 CHECK (donut_numeric_is_finite(recorded_quantity) AND recorded_quantity >= 0),
  recorded_turnover numeric NOT NULL DEFAULT 0 CHECK (donut_numeric_is_finite(recorded_turnover) AND recorded_turnover >= 0),
  listing_count bigint CHECK (listing_count IS NULL OR listing_count >= 0),
  listed_quantity numeric CHECK (listed_quantity IS NULL OR (donut_numeric_is_finite(listed_quantity) AND listed_quantity >= 0)),
  lowest_ask numeric CHECK (lowest_ask IS NULL OR (donut_numeric_is_finite(lowest_ask) AND lowest_ask >= 0)),
  highest_ask numeric CHECK (highest_ask IS NULL OR (donut_numeric_is_finite(highest_ask) AND highest_ask >= 0)),
  confidence text NOT NULL CHECK (confidence IN ('high', 'medium', 'low', 'unknown')),
  completeness text NOT NULL CHECK (completeness IN ('complete', 'partial', 'gapped', 'unknown')),
  computation_version text NOT NULL,
  computed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (source_id, item_variant_id, market_side, interval_name, bucket_start, computation_version),
  CONSTRAINT candle_bucket_order CHECK (bucket_end > bucket_start),
  CONSTRAINT market_candle_variant_item_fk
    FOREIGN KEY (item_variant_id, canonical_item_id)
    REFERENCES item_variants(id, canonical_item_id) ON DELETE RESTRICT,
  CONSTRAINT market_candle_source_variant_fk
    FOREIGN KEY (source_id, item_variant_id)
    REFERENCES source_item_variants(source_id, item_variant_id) ON DELETE RESTRICT
);

CREATE INDEX market_candles_variant_range_idx
  ON market_candles (item_variant_id, market_side, interval_name, bucket_start DESC);
CREATE INDEX market_candles_item_range_idx
  ON market_candles (canonical_item_id, market_side, interval_name, bucket_start DESC);

CREATE INDEX logical_transactions_source_variant_aggregate_idx
  ON logical_transactions (source_id, item_variant_id, source_sold_at DESC);
CREATE INDEX listing_observations_source_variant_aggregate_idx
  ON listing_observations (source_id, item_variant_id, observed_at DESC);

CREATE TABLE market_summaries (
  id uuid PRIMARY KEY,
  source_id uuid NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  canonical_item_id uuid NOT NULL REFERENCES canonical_items(id) ON DELETE RESTRICT,
  item_variant_id uuid NOT NULL REFERENCES item_variants(id) ON DELETE RESTRICT,
  window_name text NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  lowest_ask numeric CHECK (lowest_ask IS NULL OR (donut_numeric_is_finite(lowest_ask) AND lowest_ask >= 0)),
  recent_sale_median numeric CHECK (recent_sale_median IS NULL OR (donut_numeric_is_finite(recent_sale_median) AND recent_sale_median >= 0)),
  quantity_weighted_sale_price numeric CHECK (
    quantity_weighted_sale_price IS NULL
    OR (donut_numeric_is_finite(quantity_weighted_sale_price) AND quantity_weighted_sale_price >= 0)
  ),
  most_recent_sale_price numeric CHECK (most_recent_sale_price IS NULL OR (donut_numeric_is_finite(most_recent_sale_price) AND most_recent_sale_price >= 0)),
  sample_count bigint NOT NULL DEFAULT 0 CHECK (sample_count >= 0),
  recorded_quantity numeric NOT NULL DEFAULT 0 CHECK (donut_numeric_is_finite(recorded_quantity) AND recorded_quantity >= 0),
  recorded_turnover numeric NOT NULL DEFAULT 0 CHECK (donut_numeric_is_finite(recorded_turnover) AND recorded_turnover >= 0),
  active_listing_count bigint NOT NULL DEFAULT 0 CHECK (active_listing_count >= 0),
  active_listed_quantity numeric NOT NULL DEFAULT 0 CHECK (donut_numeric_is_finite(active_listed_quantity) AND active_listed_quantity >= 0),
  observed_at timestamptz NOT NULL,
  source_timestamp timestamptz,
  confidence text NOT NULL CHECK (confidence IN ('high', 'medium', 'low', 'unknown')),
  freshness text NOT NULL CHECK (freshness IN ('live', 'recent', 'aging', 'stale', 'unavailable')),
  completeness text NOT NULL CHECK (completeness IN ('complete', 'partial', 'gapped', 'unknown')),
  gap_status text NOT NULL CHECK (gap_status IN ('none', 'possible', 'confirmed', 'unknown')),
  computation_version text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (source_id, item_variant_id, window_name, computation_version),
  CONSTRAINT market_summary_window_order CHECK (window_end > window_start),
  CONSTRAINT market_summary_variant_item_fk
    FOREIGN KEY (item_variant_id, canonical_item_id)
    REFERENCES item_variants(id, canonical_item_id) ON DELETE RESTRICT,
  CONSTRAINT market_summary_source_variant_fk
    FOREIGN KEY (source_id, item_variant_id)
    REFERENCES source_item_variants(source_id, item_variant_id) ON DELETE RESTRICT
);

CREATE INDEX market_summaries_item_idx
  ON market_summaries (canonical_item_id, window_name, observed_at DESC);

CREATE TABLE users (
  id uuid PRIMARY KEY,
  email_normalized text NOT NULL UNIQUE CHECK (email_normalized = lower(email_normalized)),
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'disabled')),
  password_hash text,
  seller_visibility text NOT NULL DEFAULT 'hidden'
    CHECK (seller_visibility IN ('full', 'name_only', 'pseudonymized', 'hidden')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE UNIQUE INDEX users_single_owner_idx ON users ((role)) WHERE role = 'owner';

CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  token_kind text NOT NULL DEFAULT 'browser' CHECK (token_kind IN ('browser', 'mod', 'api')),
  scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  revocation_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT session_expiration CHECK (expires_at > created_at),
  UNIQUE (id, user_id)
);

CREATE INDEX sessions_user_active_idx
  ON sessions (user_id, expires_at DESC) WHERE revoked_at IS NULL;

COMMENT ON TABLE sessions IS 'Only SHA-256 or stronger token digests are stored; raw bearer tokens are forbidden.';

CREATE TABLE watchlists (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (user_id, name)
);

CREATE TABLE watchlist_items (
  id uuid PRIMARY KEY,
  watchlist_id uuid NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  canonical_item_id uuid NOT NULL REFERENCES canonical_items(id) ON DELETE RESTRICT,
  item_variant_id uuid REFERENCES item_variants(id) ON DELETE RESTRICT,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT watchlist_item_variant_item_fk
    FOREIGN KEY (item_variant_id, canonical_item_id)
    REFERENCES item_variants(id, canonical_item_id) ON DELETE RESTRICT
);

CREATE INDEX watchlist_items_variant_idx ON watchlist_items (item_variant_id);
CREATE UNIQUE INDEX watchlist_items_base_unique_idx
  ON watchlist_items (watchlist_id, canonical_item_id) WHERE item_variant_id IS NULL;
CREATE UNIQUE INDEX watchlist_items_variant_unique_idx
  ON watchlist_items (watchlist_id, canonical_item_id, item_variant_id)
  WHERE item_variant_id IS NOT NULL;

CREATE TABLE alert_rules (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  canonical_item_id uuid REFERENCES canonical_items(id) ON DELETE RESTRICT,
  item_variant_id uuid REFERENCES item_variants(id) ON DELETE RESTRICT,
  rule_type text NOT NULL,
  parameters jsonb NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  cooldown_seconds integer NOT NULL DEFAULT 300 CHECK (cooldown_seconds >= 0),
  last_triggered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id, user_id),
  CONSTRAINT alert_rule_variant_requires_item CHECK (
    item_variant_id IS NULL OR canonical_item_id IS NOT NULL
  ),
  CONSTRAINT alert_rule_variant_item_fk
    FOREIGN KEY (item_variant_id, canonical_item_id)
    REFERENCES item_variants(id, canonical_item_id) ON DELETE RESTRICT
);

CREATE INDEX alert_rules_user_enabled_idx ON alert_rules (user_id) WHERE enabled;
CREATE INDEX alert_rules_variant_enabled_idx ON alert_rules (item_variant_id) WHERE enabled;

CREATE TABLE alert_events (
  id uuid PRIMARY KEY,
  alert_rule_id uuid NOT NULL REFERENCES alert_rules(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  dedupe_key text NOT NULL,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  confidence text NOT NULL CHECK (confidence IN ('high', 'medium', 'low', 'unknown')),
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (alert_rule_id, dedupe_key),
  CONSTRAINT alert_event_rule_user_fk FOREIGN KEY (alert_rule_id, user_id)
    REFERENCES alert_rules(id, user_id) ON DELETE RESTRICT
);

CREATE INDEX alert_events_user_time_idx ON alert_events (user_id, occurred_at DESC);

CREATE TABLE dashboard_layouts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name text NOT NULL,
  layout_version integer NOT NULL DEFAULT 1 CHECK (layout_version >= 1),
  layout jsonb NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (user_id, name)
);

CREATE UNIQUE INDEX dashboard_layout_single_default_idx
  ON dashboard_layouts (user_id) WHERE is_default;

CREATE TABLE feature_availability (
  id uuid PRIMARY KEY,
  feature_key text NOT NULL,
  source_id uuid REFERENCES sources(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('available', 'degraded', 'unavailable', 'disabled', 'planned')),
  reason text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE UNIQUE INDEX feature_availability_global_unique_idx
  ON feature_availability (feature_key) WHERE source_id IS NULL;
CREATE UNIQUE INDEX feature_availability_source_unique_idx
  ON feature_availability (feature_key, source_id) WHERE source_id IS NOT NULL;

CREATE TABLE fee_rules (
  id uuid PRIMARY KEY,
  source_id uuid NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  rule_type text NOT NULL,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  calculation jsonb NOT NULL,
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  evidence jsonb NOT NULL,
  confidence text NOT NULL CHECK (confidence IN ('confirmed', 'likely', 'possible', 'unknown')),
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fee_rule_effective_order CHECK (
    effective_until IS NULL OR effective_until > effective_from
  )
);

COMMENT ON TABLE fee_rules IS
  'Rules remain disabled until evidence establishes the applicable fee; unknown fees must not produce net profit.';

CREATE INDEX fee_rules_effective_idx
  ON fee_rules (source_id, rule_type, effective_from DESC) WHERE enabled;

CREATE TABLE outbox_events (
  sequence_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL UNIQUE,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  event_type text NOT NULL,
  audience text NOT NULL DEFAULT 'owner' CHECK (audience IN ('owner', 'authenticated', 'admin', 'internal')),
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at timestamptz,
  publish_attempts integer NOT NULL DEFAULT 0 CHECK (publish_attempts >= 0),
  next_attempt_at timestamptz
);

COMMENT ON COLUMN outbox_events.payload IS
  'Payload must already satisfy audience privacy policy; never enqueue raw upstream secrets or seller PII for broad audiences.';

CREATE INDEX outbox_events_pending_idx
  ON outbox_events (sequence_id) WHERE published_at IS NULL;
CREATE INDEX outbox_events_resume_idx ON outbox_events (sequence_id, occurred_at);

CREATE TABLE audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL UNIQUE,
  actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  actor_session_id uuid REFERENCES sessions(id) ON DELETE RESTRICT,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  before_state jsonb,
  after_state jsonb,
  request_id text,
  network_fingerprint text,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT audit_event_session_user_fk FOREIGN KEY (actor_session_id, actor_user_id)
    REFERENCES sessions(id, user_id) ON DELETE RESTRICT
);

CREATE INDEX audit_events_actor_time_idx ON audit_events (actor_user_id, occurred_at DESC);
CREATE INDEX audit_events_target_time_idx ON audit_events (target_type, target_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION protect_alert_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'alert events cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF (to_jsonb(NEW) - 'acknowledged_at') IS DISTINCT FROM
     (to_jsonb(OLD) - 'acknowledged_at') THEN
    RAISE EXCEPTION 'alert event evidence is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.acknowledged_at IS NOT NULL
     AND NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at THEN
    RAISE EXCEPTION 'alert acknowledgement is immutable once recorded'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION protect_outbox_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'outbox events cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF (to_jsonb(NEW) - ARRAY['published_at', 'publish_attempts', 'next_attempt_at']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['published_at', 'publish_attempts', 'next_attempt_at']) THEN
    RAISE EXCEPTION 'outbox event content is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.published_at IS NOT NULL
     AND NEW.published_at IS DISTINCT FROM OLD.published_at THEN
    RAISE EXCEPTION 'outbox publication time is immutable once recorded'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.publish_attempts < OLD.publish_attempts THEN
    RAISE EXCEPTION 'outbox publish attempts cannot decrease'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER alert_events_protected
  BEFORE UPDATE OR DELETE ON alert_events
  FOR EACH ROW EXECUTE FUNCTION protect_alert_event_mutation();
CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();
CREATE TRIGGER outbox_events_protected
  BEFORE UPDATE OR DELETE ON outbox_events
  FOR EACH ROW EXECUTE FUNCTION protect_outbox_event_mutation();
