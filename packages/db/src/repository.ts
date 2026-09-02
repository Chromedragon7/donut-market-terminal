import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import type {
  AuditEventInput,
  AggregationRefreshInput,
  AggregationRefreshResult,
  CanonicalItemInput,
  CheckpointInput,
  CheckpointState,
  CollectionRunFinalization,
  CollectionRunCompletion,
  CollectionRunInput,
  GapInput,
  HealthSampleInput,
  ItemVariantInput,
  JsonObject,
  Lease,
  ListingObservationInput,
  ListingSnapshotInput,
  OutboxEvent,
  OutboxEventInput,
  Queryable,
  QuarantinedRecordInput,
  RawPayloadInput,
  SellerInput,
  SourceInput,
  SourceRequestInput,
  TransactionObservationInput,
  TransactionPersistResult,
} from "./types.js";
import { refreshMarketAggregates as refreshAggregates } from "./aggregates.js";

interface IdRow extends QueryResultRow {
  readonly id: string;
}

interface ObservationRow extends QueryResultRow {
  readonly id: string;
}

interface DedupeRow extends QueryResultRow {
  readonly logical_transaction_id: string | null;
}

interface LeaseRow extends QueryResultRow {
  readonly lease_key: string;
  readonly owner_id: string;
  readonly fencing_token: string;
  readonly acquired_at: Date;
  readonly expires_at: Date;
}

interface BooleanRow extends QueryResultRow {
  readonly ok: boolean;
}

interface CountRow extends QueryResultRow {
  readonly count: string;
}

interface CheckpointRow extends QueryResultRow {
  readonly source_id: string;
  readonly resource: string;
  readonly checkpoint_version: string;
  readonly cursor_data: JsonObject;
  readonly next_run_at: Date | null;
  readonly last_success_at: Date | null;
  readonly updated_at: Date;
}

interface OutboxRow extends QueryResultRow {
  readonly sequence_id: string;
  readonly event_id: string;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly event_type: string;
  readonly audience: OutboxEvent["audience"];
  readonly payload: JsonObject;
  readonly occurred_at: Date;
}

export interface AdvisoryLockResult<T> {
  readonly acquired: boolean;
  readonly value?: T;
}

export class MarketRepository {
  public constructor(private readonly pool: Pool) {}

  public async ping(): Promise<boolean> {
    const result = await this.pool.query<BooleanRow>("SELECT true AS ok");
    return result.rows[0]?.ok === true;
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }

  public async withTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let began = false;
    try {
      await client.query("BEGIN");
      began = true;
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      if (began) {
        await client.query("ROLLBACK").catch(() => undefined);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  public async withAdvisoryLock<T>(
    lockKey: string,
    operation: (lockSignal: AbortSignal) => Promise<T>,
  ): Promise<AdvisoryLockResult<T>> {
    const client = await this.pool.connect();
    const lockLost = new AbortController();
    const handleClientError = (error: Error): void => { lockLost.abort(error); };
    client.once("error", handleClientError);
    try {
      const lock = await client.query<BooleanRow>(
        "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS ok",
        [lockKey],
      );
      if (lock.rows[0]?.ok !== true) {
        return { acquired: false };
      }

      let operationFailed = false;
      try {
        return { acquired: true, value: await operation(lockLost.signal) };
      } catch (error) {
        operationFailed = true;
        throw error;
      } finally {
        await client.query(
          "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
          [lockKey],
        ).catch((unlockError: unknown) => {
          if (!operationFailed) throw unlockError;
        });
      }
    } finally {
      client.off("error", handleClientError);
      client.release();
    }
  }

  public async upsertSource(input: SourceInput): Promise<string> {
    const id = randomUUID();
    const result = await this.pool.query<IdRow>(
      `INSERT INTO sources (
         id, source_key, source_type, display_name, endpoint_metadata, enabled, trust_level
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
       ON CONFLICT (source_key) DO UPDATE SET
         source_type = EXCLUDED.source_type,
         display_name = EXCLUDED.display_name,
         endpoint_metadata = EXCLUDED.endpoint_metadata,
         enabled = EXCLUDED.enabled,
         trust_level = EXCLUDED.trust_level,
         updated_at = clock_timestamp()
       RETURNING id`,
      [
        id,
        input.key,
        input.type,
        input.displayName,
        toJson(input.endpointMetadata),
        input.enabled ?? true,
        input.trustLevel ?? "unverified",
      ],
    );
    return requiredId(result.rows[0], "source");
  }

  public async startCollectionRun(input: CollectionRunInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO collection_runs (
         id, source_id, resource, mode, status, started_at, collector_version,
         provider_version, validation_version, normalization_version, dedupe_version,
         schedule_version, instance_id, configuration
       ) VALUES ($1, $2, $3, $4, 'running', $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [
        input.id,
        input.sourceId,
        input.resource,
        input.mode,
        input.startedAt,
        input.collectorVersion,
        input.providerVersion,
        input.validationVersion,
        input.normalizationVersion,
        input.dedupeVersion,
        input.scheduleVersion,
        input.instanceId,
        toJson(input.configuration),
      ],
    );
  }

  public async completeCollectionRun(
    runId: string,
    completion: CollectionRunCompletion,
    queryable: Queryable = this.pool,
  ): Promise<void> {
    const result = await queryable.query(
      `UPDATE collection_runs SET
         status = $2,
         completed_at = $3,
         request_count = $4,
         response_count = $5,
         received_count = $6,
         new_count = $7,
         duplicate_count = $8,
         invalid_count = $9,
         error_summary = $10::jsonb,
         rate_limit_summary = $11::jsonb,
         latency_summary = $12::jsonb,
         continuation = $13::jsonb
       WHERE id = $1 AND status = 'running'`,
      [
        runId,
        completion.status,
        completion.completedAt,
        completion.requestCount,
        completion.responseCount,
        completion.receivedCount,
        completion.newCount,
        completion.duplicateCount,
        completion.invalidCount,
        toJson(completion.errorSummary),
        toJson(completion.rateLimitSummary),
        toJson(completion.latencySummary),
        toJson(completion.continuation),
      ],
    );
    if (result.rowCount !== 1) {
      throw new Error(`Collection run ${runId} was not running or does not exist`);
    }
  }

  public async markAbandonedRunsPartial(
    sourceId: string,
    instanceId: string,
    abandonedBefore: Date,
  ): Promise<number> {
    const result = await this.pool.query(
      `UPDATE collection_runs SET
         status = 'partial',
         completed_at = clock_timestamp(),
         error_summary = error_summary || jsonb_build_object(
           'code', 'collector_restart',
           'recovered_by_instance', $2,
           'recovered_at', clock_timestamp()
         )
       WHERE source_id = $1
         AND status = 'running'
         AND started_at < $3`,
      [sourceId, instanceId, abandonedBefore],
    );
    return result.rowCount ?? 0;
  }

  public async appendRawPayload(input: RawPayloadInput, queryable: Queryable = this.pool): Promise<void> {
    const bytes = Buffer.from(input.bytes);
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    if (actualHash !== input.sha256) {
      throw new Error("Raw payload SHA-256 does not match the supplied bytes");
    }

    await queryable.query(
      `INSERT INTO raw_payloads (
         sha256, body, byte_length, content_type, content_encoding, first_observed_at
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (sha256) DO NOTHING`,
      [
        input.sha256,
        bytes,
        bytes.byteLength,
        input.contentType ?? null,
        input.contentEncoding ?? null,
        input.firstObservedAt,
      ],
    );
  }

  public async appendSourceRequest(
    input: SourceRequestInput,
    queryable: Queryable = this.pool,
  ): Promise<void> {
    await queryable.query(
      `INSERT INTO source_requests (
         id, run_id, source_id, resource, page, attempt, requested_at, responded_at,
         latency_ms, http_status, request_metadata, response_payload_sha256, response_bytes,
         validation_status, completeness_status, error_code, error_message,
         rate_limit_metadata, provider_version
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13,
         $14, $15, $16, $17, $18::jsonb, $19
       ) ON CONFLICT (id) DO NOTHING`,
      [
        input.id,
        input.runId,
        input.sourceId,
        input.resource,
        input.page ?? null,
        input.attempt,
        input.requestedAt,
        input.respondedAt ?? null,
        input.latencyMs ?? null,
        input.httpStatus ?? null,
        toJson(input.requestMetadata),
        input.responsePayloadSha256 ?? null,
        input.responseBytes ?? null,
        input.validationStatus,
        input.completenessStatus,
        input.errorCode ?? null,
        input.errorMessage ?? null,
        toJson(input.rateLimitMetadata),
        input.providerVersion,
      ],
    );
  }

  public async appendFetchEvidence(
    payload: RawPayloadInput | undefined,
    request: SourceRequestInput,
  ): Promise<void> {
    await this.withTransaction(async (client) => {
      if (payload !== undefined) {
        await this.appendRawPayload(payload, client);
      }
      await this.appendSourceRequest(request, client);
    });
  }

  public async upsertCanonicalItem(
    input: CanonicalItemInput,
    queryable: Queryable = this.pool,
  ): Promise<string> {
    const result = await queryable.query<IdRow>(
      `INSERT INTO canonical_items (id, minecraft_id, namespace, item_path, display_name)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (minecraft_id) DO UPDATE SET
         display_name = COALESCE(EXCLUDED.display_name, canonical_items.display_name),
         updated_at = clock_timestamp()
       WHERE canonical_items.namespace = EXCLUDED.namespace
         AND canonical_items.item_path = EXCLUDED.item_path
       RETURNING id`,
      [input.id, input.minecraftId, input.namespace, input.path, input.displayName ?? null],
    );
    return requiredId(result.rows[0], "canonical item");
  }

  public async upsertItemVariant(
    input: ItemVariantInput,
    queryable: Queryable = this.pool,
  ): Promise<string> {
    const result = await queryable.query<IdRow>(
      `INSERT INTO item_variants (
         id, canonical_item_id, fingerprint, fingerprint_version, canonical_metadata,
         identity_state, completeness
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb)
       ON CONFLICT (fingerprint_version, fingerprint) DO UPDATE SET
         completeness = EXCLUDED.completeness
       WHERE item_variants.canonical_item_id = EXCLUDED.canonical_item_id
         AND item_variants.canonical_metadata = EXCLUDED.canonical_metadata
       RETURNING id`,
      [
        input.id,
        input.canonicalItemId,
        input.fingerprint,
        input.fingerprintVersion,
        toJson(input.canonicalMetadata),
        input.identityState,
        toJson(input.completeness),
      ],
    );
    return requiredId(result.rows[0], "item variant");
  }

  public async upsertSeller(input: SellerInput, queryable: Queryable = this.pool): Promise<string> {
    const result = await queryable.query<IdRow>(
      `INSERT INTO sellers (
         id, source_id, source_seller_id, current_name, visibility_policy,
         first_observed_at, last_observed_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $6)
       ON CONFLICT (source_id, source_seller_id) DO UPDATE SET
         current_name = COALESCE(EXCLUDED.current_name, sellers.current_name),
         last_observed_at = GREATEST(sellers.last_observed_at, EXCLUDED.last_observed_at),
         updated_at = clock_timestamp()
       RETURNING id`,
      [
        input.id,
        input.sourceId,
        input.sourceSellerId,
        input.currentName ?? null,
        input.visibilityPolicy ?? "owner_full",
        input.observedAt,
      ],
    );
    return requiredId(result.rows[0], "seller");
  }

  public async persistTransactionObservation(
    input: TransactionObservationInput,
  ): Promise<TransactionPersistResult> {
    return this.withTransaction(async (client) => {
      const observation = await client.query<ObservationRow>(
        `INSERT INTO transaction_observations (
           request_id, run_id, source_id, record_index, page, page_position,
           observed_at, source_sold_at, canonical_item_id, item_variant_id, seller_id,
           quantity, total_price, total_price_source_text, unit_price, unit_price_exact_text,
           unit_price_numerator, unit_price_denominator, fingerprint,
           occurrence_ordinal, fingerprint_version, normalization_version,
           validation_status, confidence, flags, raw_record
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
           $12, $13::numeric, $14, $15::numeric, $16, $17::numeric, $18::numeric,
           $19, $20, $21, $22, $23, $24, $25::jsonb, $26::jsonb
         )
         ON CONFLICT (request_id, record_index) DO NOTHING
         RETURNING id::text AS id`,
        [
          input.requestId,
          input.runId,
          input.sourceId,
          input.recordIndex,
          input.page,
          input.pagePosition,
          input.observedAt,
          input.sourceSoldAt,
          input.canonicalItemId,
          input.itemVariantId,
          input.sellerId ?? null,
          input.quantity,
          input.totalPrice,
          input.totalPriceSourceText,
          input.unitPrice,
          input.unitPriceExactText,
          input.unitPriceNumerator,
          input.unitPriceDenominator,
          input.fingerprint,
          input.occurrenceOrdinal,
          input.fingerprintVersion,
          input.normalizationVersion,
          input.validationStatus,
          input.confidence,
          toJson(input.flags),
          input.rawRecord === undefined ? null : JSON.stringify(input.rawRecord),
        ],
      );

      const insertedObservation = observation.rows[0];
      if (insertedObservation === undefined) {
        const existing = await client.query<ObservationRow>(
          `SELECT id::text AS id FROM transaction_observations
           WHERE request_id = $1 AND record_index = $2`,
          [input.requestId, input.recordIndex],
        );
        const existingId = requiredId(existing.rows[0], "transaction observation");
        const decision = await client.query<DedupeRow>(
          `SELECT logical_transaction_id
           FROM transaction_dedupe_decisions
           WHERE observation_id = $1 AND algorithm_version = $2`,
          [existingId, input.dedupeVersion],
        );
        const logicalId = decision.rows[0]?.logical_transaction_id ?? undefined;
        return logicalId === undefined
          ? { observationId: existingId, isNewLogicalTransaction: false }
          : {
              observationId: existingId,
              logicalTransactionId: logicalId,
              isNewLogicalTransaction: false,
            };
      }

      await this.touchSourceItemVariant(
        client,
        input.sourceId,
        input.canonicalItemId,
        input.itemVariantId,
        input.observedAt,
      );

      if (input.validationStatus === "quarantined") {
        await client.query(
          `INSERT INTO transaction_dedupe_decisions (
             observation_id, logical_transaction_id, algorithm_version, decision, evidence
           ) VALUES ($1, NULL, $2, 'quarantined', $3::jsonb)
           ON CONFLICT (observation_id, algorithm_version) DO NOTHING`,
          [insertedObservation.id, input.dedupeVersion, toJson(input.flags)],
        );
        return { observationId: insertedObservation.id, isNewLogicalTransaction: false };
      }

      const logicalId = randomUUID();
      const insertedLogical = await client.query<IdRow>(
        `INSERT INTO logical_transactions (
           id, source_id, fingerprint, collision_ordinal, dedupe_version, source_sold_at,
           canonical_item_id, item_variant_id, seller_id, quantity, total_price,
           total_price_source_text, unit_price, unit_price_exact_text,
           unit_price_numerator, unit_price_denominator, first_observed_at, last_observed_at,
           collision_state, confidence
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::numeric,
           $12, $13::numeric, $14, $15::numeric, $16::numeric, $17, $17, $18, $19
         )
         ON CONFLICT (source_id, fingerprint, collision_ordinal, dedupe_version) DO NOTHING
         RETURNING id`,
        [
          logicalId,
          input.sourceId,
          input.fingerprint,
          input.occurrenceOrdinal,
          input.dedupeVersion,
          input.sourceSoldAt,
          input.canonicalItemId,
          input.itemVariantId,
          input.sellerId ?? null,
          input.quantity,
          input.totalPrice,
          input.totalPriceSourceText,
          input.unitPrice,
          input.unitPriceExactText,
          input.unitPriceNumerator,
          input.unitPriceDenominator,
          input.observedAt,
          input.collisionAmbiguous ? "ambiguous" : "none",
          input.confidence,
        ],
      );

      const isNew = insertedLogical.rows[0] !== undefined;
      const resolvedLogicalId = isNew
        ? requiredId(insertedLogical.rows[0], "logical transaction")
        : await this.touchExistingLogicalTransaction(client, input);

      await client.query(
        `INSERT INTO transaction_dedupe_decisions (
           observation_id, logical_transaction_id, algorithm_version, decision, evidence
         ) VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (observation_id, algorithm_version) DO NOTHING`,
        [
          insertedObservation.id,
          resolvedLogicalId,
          input.dedupeVersion,
          input.collisionAmbiguous ? "possible_collision" : isNew ? "new" : "repeat",
          toJson({
            occurrenceOrdinal: input.occurrenceOrdinal,
            collisionAmbiguous: input.collisionAmbiguous,
          }),
        ],
      );

      if (isNew) {
        await this.appendOutboxEvent({
          eventId: randomUUID(),
          aggregateType: "logical_transaction",
          aggregateId: resolvedLogicalId,
          eventType: "market.transaction.recorded",
          audience: "authenticated",
          payload: {
            sourceId: input.sourceId,
            canonicalItemId: input.canonicalItemId,
            itemVariantId: input.itemVariantId,
            quantity: input.quantity,
            totalPrice: input.totalPrice,
            unitPrice: input.unitPrice,
            unitPriceExactText: input.unitPriceExactText,
            sourceSoldAt: input.sourceSoldAt.toISOString(),
            confidence: input.confidence,
            sellerIncluded: false,
          },
          occurredAt: input.observedAt,
        }, client);
      }

      return {
        observationId: insertedObservation.id,
        logicalTransactionId: resolvedLogicalId,
        isNewLogicalTransaction: isNew,
      };
    });
  }

  private async touchExistingLogicalTransaction(
    client: PoolClient,
    input: TransactionObservationInput,
  ): Promise<string> {
    const result = await client.query<IdRow>(
      `UPDATE logical_transactions SET
         first_observed_at = LEAST(first_observed_at, $5),
         last_observed_at = GREATEST(last_observed_at, $5),
         observation_count = observation_count + 1,
         collision_state = CASE
           WHEN $6 THEN 'ambiguous'
           ELSE collision_state
         END,
         confidence = CASE WHEN $6 THEN 'low' ELSE confidence END,
         updated_at = clock_timestamp()
       WHERE source_id = $1
         AND fingerprint = $2
         AND dedupe_version = $3
         AND collision_ordinal = $4
       RETURNING id`,
      [
        input.sourceId,
        input.fingerprint,
        input.dedupeVersion,
        input.occurrenceOrdinal,
        input.observedAt,
        input.collisionAmbiguous,
      ],
    );
    return requiredId(result.rows[0], "logical transaction");
  }

  public async appendListingSnapshot(
    input: ListingSnapshotInput,
    queryable: Queryable = this.pool,
  ): Promise<void> {
    await queryable.query(
      `INSERT INTO listing_snapshots (
         id, run_id, source_id, observed_at, completed_at, status, search_text, sort_mode,
         first_page, last_page, positions_observed, nonnull_listings, consistency,
         fingerprint_version, evidence
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb
       ) ON CONFLICT (id) DO NOTHING`,
      [
        input.id,
        input.runId,
        input.sourceId,
        input.observedAt,
        input.completedAt ?? null,
        input.status,
        input.search ?? null,
        input.sort ?? null,
        input.firstPage,
        input.lastPage ?? null,
        input.positionsObserved,
        input.nonnullListings,
        input.consistency,
        input.fingerprintVersion,
        toJson(input.evidence),
      ],
    );
  }

  public async appendListingObservation(
    input: ListingObservationInput,
    queryable: Queryable = this.pool,
  ): Promise<string> {
    const result = await queryable.query<ObservationRow>(
      `INSERT INTO listing_observations (
         request_id, snapshot_id, run_id, source_id, record_index, page, page_position,
         observed_at, canonical_item_id, item_variant_id, seller_id, quantity,
         total_ask_price, total_ask_price_source_text, unit_ask_price, unit_ask_price_exact_text,
         unit_ask_price_numerator, unit_ask_price_denominator, remaining_time_text,
         approximate_expires_at, fingerprint, fingerprint_version, confidence, flags, raw_record
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
         $13::numeric, $14, $15::numeric, $16, $17::numeric, $18::numeric, $19, $20,
         $21, $22, $23, $24::jsonb, $25::jsonb
       )
       ON CONFLICT (request_id, record_index) DO NOTHING
       RETURNING id::text AS id`,
      [
        input.requestId,
        input.snapshotId,
        input.runId,
        input.sourceId,
        input.recordIndex,
        input.page,
        input.pagePosition,
        input.observedAt,
        input.canonicalItemId,
        input.itemVariantId,
        input.sellerId ?? null,
        input.quantity,
        input.totalAskPrice,
        input.totalAskPriceSourceText,
        input.unitAskPrice,
        input.unitAskPriceExactText,
        input.unitAskPriceNumerator,
        input.unitAskPriceDenominator,
        input.remainingTimeText ?? null,
        input.approximateExpiresAt ?? null,
        input.fingerprint,
        input.fingerprintVersion,
        input.confidence,
        toJson(input.flags),
        input.rawRecord === undefined ? null : JSON.stringify(input.rawRecord),
      ],
    );
    if (result.rows[0] !== undefined) {
      await this.touchSourceItemVariant(
        queryable,
        input.sourceId,
        input.canonicalItemId,
        input.itemVariantId,
        input.observedAt,
      );
      return result.rows[0].id;
    }
    const existing = await queryable.query<ObservationRow>(
      `SELECT id::text AS id FROM listing_observations
       WHERE request_id = $1 AND record_index = $2`,
      [input.requestId, input.recordIndex],
    );
    await this.touchSourceItemVariant(
      queryable,
      input.sourceId,
      input.canonicalItemId,
      input.itemVariantId,
      input.observedAt,
    );
    return requiredId(existing.rows[0], "listing observation");
  }

  private async touchSourceItemVariant(
    queryable: Queryable,
    sourceId: string,
    canonicalItemId: string,
    itemVariantId: string,
    observedAt: Date,
  ): Promise<void> {
    const result = await queryable.query(
      `INSERT INTO source_item_variants (
         source_id, canonical_item_id, item_variant_id, first_observed_at, last_observed_at
       ) VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (source_id, item_variant_id) DO UPDATE SET
         first_observed_at = LEAST(source_item_variants.first_observed_at, EXCLUDED.first_observed_at),
         last_observed_at = GREATEST(source_item_variants.last_observed_at, EXCLUDED.last_observed_at)
       WHERE source_item_variants.canonical_item_id = EXCLUDED.canonical_item_id`,
      [sourceId, canonicalItemId, itemVariantId, observedAt],
    );
    if (result.rowCount !== 1) {
      throw new Error("Source/item-variant provenance conflicts with the canonical item");
    }
  }

  public async persistListingSnapshot(
    snapshot: ListingSnapshotInput,
    observations: readonly ListingObservationInput[],
  ): Promise<readonly string[]> {
    return this.withTransaction(async (client) => {
      await this.appendListingSnapshot(snapshot, client);
      const observationIds: string[] = [];
      for (const observation of observations) {
        observationIds.push(await this.appendListingObservation(observation, client));
      }
      await this.appendOutboxEvent({
        eventId: snapshot.id,
        aggregateType: "listing_snapshot",
        aggregateId: snapshot.id,
        eventType: "market.listing.changed",
        audience: "authenticated",
        payload: {
          sourceId: snapshot.sourceId,
          snapshotId: snapshot.id,
          status: snapshot.status,
          observationCount: observationIds.length,
          sellerIncluded: false,
        },
        occurredAt: snapshot.completedAt ?? snapshot.observedAt,
      }, client);
      return observationIds;
    });
  }

  public async appendQuarantinedRecord(input: QuarantinedRecordInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO quarantined_records (
         request_id, run_id, source_id, resource, record_index, page, observed_at,
         raw_record, validation_errors, validation_version
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)
       ON CONFLICT (request_id, record_index) DO NOTHING`,
      [
        input.requestId,
        input.runId,
        input.sourceId,
        input.resource,
        input.recordIndex,
        input.page ?? null,
        input.observedAt,
        input.rawRecord === undefined ? null : JSON.stringify(input.rawRecord),
        JSON.stringify(input.validationErrors),
        input.validationVersion,
      ],
    );
  }

  public async appendHealthSample(
    input: HealthSampleInput,
    queryable: Queryable = this.pool,
  ): Promise<void> {
    await queryable.query(
      `INSERT INTO source_health_samples (
         source_id, observed_at, status, metrics, reason, run_id
       ) VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
      [
        input.sourceId,
        input.observedAt,
        input.status,
        toJson(input.metrics),
        input.reason ?? null,
        input.runId ?? null,
      ],
    );
  }

  public async recordGap(input: GapInput, queryable: Queryable = this.pool): Promise<void> {
    await queryable.query(
      `INSERT INTO data_gaps (
         id, source_id, resource, gap_start, gap_end, detected_at, reason, confidence,
         detection_version, evidence, first_run_id, last_run_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
       ON CONFLICT (id) DO NOTHING`,
      [
        input.id,
        input.sourceId,
        input.resource,
        input.gapStart,
        input.gapEnd ?? null,
        input.detectedAt,
        input.reason,
        input.confidence,
        input.detectionVersion,
        toJson(input.evidence),
        input.firstRunId ?? null,
        input.lastRunId ?? null,
      ],
    );
  }

  public async acquireLease(key: string, ownerId: string, ttlMs: number): Promise<Lease | null> {
    requirePositiveDuration(ttlMs);
    const result = await this.pool.query<LeaseRow>(
      `INSERT INTO collector_leases (
         lease_key, owner_id, fencing_token, acquired_at, heartbeat_at, expires_at
       ) VALUES (
         $1, $2, 1, clock_timestamp(), clock_timestamp(),
         clock_timestamp() + ($3::bigint * interval '1 millisecond')
       )
       ON CONFLICT (lease_key) DO UPDATE SET
         owner_id = EXCLUDED.owner_id,
         fencing_token = collector_leases.fencing_token + 1,
         acquired_at = clock_timestamp(),
         heartbeat_at = clock_timestamp(),
         expires_at = clock_timestamp() + ($3::bigint * interval '1 millisecond')
       WHERE collector_leases.expires_at <= clock_timestamp()
       RETURNING lease_key, owner_id, fencing_token::text, acquired_at, expires_at`,
      [key, ownerId, ttlMs],
    );
    return result.rows[0] === undefined ? null : mapLease(result.rows[0]);
  }

  public async renewLease(lease: Lease, ttlMs: number): Promise<Lease | null> {
    requirePositiveDuration(ttlMs);
    const result = await this.pool.query<LeaseRow>(
      `UPDATE collector_leases SET
         heartbeat_at = clock_timestamp(),
         expires_at = clock_timestamp() + ($4::bigint * interval '1 millisecond')
       WHERE lease_key = $1 AND owner_id = $2 AND fencing_token = $3::bigint
         AND expires_at > clock_timestamp()
       RETURNING lease_key, owner_id, fencing_token::text, acquired_at, expires_at`,
      [lease.key, lease.ownerId, lease.fencingToken, ttlMs],
    );
    return result.rows[0] === undefined ? null : mapLease(result.rows[0]);
  }

  public async releaseLease(lease: Lease): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM collector_leases
       WHERE lease_key = $1 AND owner_id = $2 AND fencing_token = $3::bigint`,
      [lease.key, lease.ownerId, lease.fencingToken],
    );
    return result.rowCount === 1;
  }

  public async saveCheckpoint(
    sourceId: string,
    resource: string,
    checkpointVersion: string,
    cursor: JsonObject,
    nextRunAt: Date | null,
    lastSuccessAt: Date | null,
    queryable: Queryable = this.pool,
  ): Promise<void> {
    await queryable.query(
      `INSERT INTO collector_checkpoints (
         source_id, resource, checkpoint_version, cursor_data, next_run_at, last_success_at
       ) VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       ON CONFLICT (source_id, resource) DO UPDATE SET
         checkpoint_version = EXCLUDED.checkpoint_version,
         cursor_data = CASE
           WHEN EXCLUDED.last_success_at IS NULL THEN collector_checkpoints.cursor_data
           ELSE EXCLUDED.cursor_data
         END,
         next_run_at = EXCLUDED.next_run_at,
         last_success_at = COALESCE(EXCLUDED.last_success_at, collector_checkpoints.last_success_at),
         updated_at = clock_timestamp()`,
      [sourceId, resource, checkpointVersion, toJson(cursor), nextRunAt, lastSuccessAt],
    );
  }

  public async readCheckpoint(sourceId: string, resource: string): Promise<CheckpointState | null> {
    const result = await this.pool.query<CheckpointRow>(
      `SELECT source_id, resource, checkpoint_version, cursor_data, next_run_at,
              last_success_at, updated_at
       FROM collector_checkpoints
       WHERE source_id = $1 AND resource = $2`,
      [sourceId, resource],
    );
    const row = result.rows[0];
    return row === undefined ? null : {
      sourceId: row.source_id,
      resource: row.resource,
      checkpointVersion: row.checkpoint_version,
      cursor: row.cursor_data,
      nextRunAt: row.next_run_at,
      lastSuccessAt: row.last_success_at,
      updatedAt: row.updated_at,
    };
  }

  public async finalizeCollectionRun(input: CollectionRunFinalization): Promise<void> {
    await this.withTransaction(async (client) => {
      await this.completeCollectionRun(input.runId, input.completion, client);
      await this.appendHealthSample(input.healthSample, client);
      for (const gap of input.gaps ?? []) {
        await this.recordGap(gap, client);
      }
      const checkpoint: CheckpointInput = input.checkpoint;
      await this.saveCheckpoint(
        checkpoint.sourceId,
        checkpoint.resource,
        checkpoint.checkpointVersion,
        checkpoint.cursor,
        checkpoint.nextRunAt,
        checkpoint.lastSuccessAt,
        client,
      );
      if (input.aggregateRefresh !== undefined) {
        const refreshed = await refreshAggregates(client, input.aggregateRefresh);
        await this.appendOutboxEvent({
          eventId: input.runId,
          aggregateType: "source",
          aggregateId: input.aggregateRefresh.sourceId,
          eventType: "market.summary",
          audience: "authenticated",
          payload: {
            sourceId: input.aggregateRefresh.sourceId,
            computationVersion: input.aggregateRefresh.computationVersion,
            saleCandlesRefreshed: refreshed.saleCandles,
            askCandlesRefreshed: refreshed.askCandles,
            summariesRefreshed: refreshed.summaries,
            sellerIncluded: false,
          },
          occurredAt: input.aggregateRefresh.computedAt,
        }, client);
      }
    });
  }

  public async refreshMarketAggregates(
    input: AggregationRefreshInput,
  ): Promise<AggregationRefreshResult> {
    return this.withTransaction((client) => refreshAggregates(client, input));
  }

  public async countPendingRuns(sourceId: string): Promise<number> {
    const result = await this.pool.query<CountRow>(
      "SELECT count(*)::text AS count FROM collection_runs WHERE source_id = $1 AND status = 'running'",
      [sourceId],
    );
    return Number.parseInt(result.rows[0]?.count ?? "0", 10);
  }

  public async appendOutboxEvent(
    input: OutboxEventInput,
    queryable: Queryable = this.pool,
  ): Promise<string> {
    const result = await queryable.query<{ sequence_id: string } & QueryResultRow>(
      `INSERT INTO outbox_events (
         event_id, aggregate_type, aggregate_id, event_type, audience, payload, occurred_at
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       ON CONFLICT (event_id) DO UPDATE SET event_id = EXCLUDED.event_id
       RETURNING sequence_id::text`,
      [input.eventId, input.aggregateType, input.aggregateId, input.eventType,
        input.audience, toJson(input.payload), input.occurredAt],
    );
    const cursor = result.rows[0]?.sequence_id;
    if (cursor === undefined) throw new Error("Database did not return an outbox cursor");
    return cursor;
  }

  public async readOutbox(
    afterCursor: string,
    limit: number,
    audiences: readonly OutboxEvent["audience"][],
  ): Promise<readonly OutboxEvent[]> {
    if (!/^\d+$/.test(afterCursor)) throw new TypeError("Outbox cursor must be an unsigned integer string");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new RangeError("Outbox limit must be from 1 through 1000");
    }
    if (audiences.length === 0) return [];
    const result = await this.pool.query<OutboxRow>(
      `SELECT sequence_id::text, event_id::text, aggregate_type, aggregate_id,
              event_type, audience, payload, occurred_at
       FROM outbox_events
       WHERE sequence_id > $1::bigint AND audience = ANY($2::text[])
       ORDER BY sequence_id
       LIMIT $3`,
      [afterCursor, audiences, limit],
    );
    return result.rows.map((row) => ({
      cursor: row.sequence_id,
      eventId: row.event_id,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      eventType: row.event_type,
      audience: row.audience,
      payload: row.payload,
      occurredAt: row.occurred_at,
    }));
  }

  public async markOutboxPublished(cursors: readonly string[]): Promise<number> {
    if (cursors.length === 0) return 0;
    if (cursors.some((cursor) => !/^\d+$/.test(cursor))) {
      throw new TypeError("Every outbox cursor must be an unsigned integer string");
    }
    const result = await this.pool.query(
      `UPDATE outbox_events SET published_at = clock_timestamp()
       WHERE sequence_id = ANY($1::bigint[]) AND published_at IS NULL`,
      [cursors],
    );
    return result.rowCount ?? 0;
  }

  public async appendAuditEvent(input: AuditEventInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_events (
         event_id, actor_user_id, actor_session_id, action, target_type, target_id,
         before_state, after_state, request_id, network_fingerprint, occurred_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)
       ON CONFLICT (event_id) DO NOTHING`,
      [input.eventId, input.actorUserId ?? null, input.actorSessionId ?? null,
        input.action, input.targetType, input.targetId ?? null,
        input.beforeState === undefined ? null : toJson(input.beforeState),
        input.afterState === undefined ? null : toJson(input.afterState),
        input.requestId ?? null, input.networkFingerprint ?? null, input.occurredAt],
    );
  }
}

function toJson(value: JsonObject | undefined): string {
  return JSON.stringify(value ?? {});
}

function requiredId(row: IdRow | ObservationRow | undefined, entity: string): string {
  if (row === undefined) {
    throw new Error(`Database did not return an id for ${entity}`);
  }
  return row.id;
}

function mapLease(row: LeaseRow): Lease {
  return {
    key: row.lease_key,
    ownerId: row.owner_id,
    fencingToken: row.fencing_token,
    acquiredAt: row.acquired_at,
    expiresAt: row.expires_at,
  };
}

function requirePositiveDuration(ttlMs: number): void {
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new RangeError("Lease TTL must be a positive safe integer number of milliseconds");
  }
}
