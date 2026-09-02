import assert from "node:assert/strict";
import { test } from "node:test";
import type { OutboxEvent as DatabaseOutboxEvent, Queryable } from "@donut/db";
import { PostgresMarketRepository } from "../src/postgres-repository.js";

interface Call {
  sql: string;
  values: readonly unknown[];
}

function harness(responder: (sql: string, values: readonly unknown[]) => { rows?: unknown[]; rowCount?: number | null }) {
  const calls: Call[] = [];
  const queryable = {
    async query(sql: string, values: readonly unknown[] = []) {
      calls.push({ sql, values });
      const response = responder(sql, values);
      return { rows: response.rows ?? [], rowCount: response.rowCount ?? response.rows?.length ?? 0 };
    },
  } as unknown as Queryable;
  const outboxReads: Array<{ cursor: string; audiences: readonly string[] }> = [];
  const database = {
    async withTransaction<T>(operation: (client: Queryable) => Promise<T>): Promise<T> {
      return operation(queryable);
    },
    async readOutbox(
      cursor: string,
      _limit: number,
      audiences: readonly DatabaseOutboxEvent["audience"][],
    ): Promise<readonly DatabaseOutboxEvent[]> {
      outboxReads.push({ cursor, audiences });
      return [];
    },
    async close() {},
  };
  return { calls, queryable, database, outboxReads };
}

test("user/session SQL is parameterized and maps the database role/privacy vocabulary", async () => {
  const rawUsername = "owner@example.test' OR true --";
  const h = harness((sql) => {
    if (sql.includes("api.findUserByUsername")) {
      return {
        rows: [{
          id: "00000000-0000-0000-0000-000000000001",
          email_normalized: "owner@example.test",
          display_name: "Owner",
          role: "owner",
          seller_visibility: "full",
          password_hash: "scrypt$v1$parameters$salt$hash",
        }],
      };
    }
    return { rows: [], rowCount: 1 };
  });
  const repository = new PostgresMarketRepository({ queryable: h.queryable, database: h.database });
  const stored = await repository.findUserByUsername(rawUsername);
  assert.equal(stored?.user.role, "owner");
  assert.equal(stored?.user.sellerPrivacy, "full");
  assert.equal(h.calls[0]?.sql.includes(rawUsername), false);
  assert.deepEqual(h.calls[0]?.values, [rawUsername]);

  await repository.createSession({
    id: "00000000-0000-0000-0000-000000000002",
    userId: "00000000-0000-0000-0000-000000000001",
    tokenHash: "a".repeat(64),
    csrfHash: "b".repeat(64),
    createdAt: "2026-09-01T00:00:00.000Z",
    expiresAt: "2026-09-02T00:00:00.000Z",
    revokedAt: null,
  });
  const create = h.calls.find((call) => call.sql.includes("api.createSession"));
  assert.ok(create);
  assert.equal(create.sql.includes("a".repeat(64)), false);
  assert.equal(create.values[2], "a".repeat(64));
  assert.deepEqual(JSON.parse(String(create.values[7])), { csrfHash: "b".repeat(64) });
});

test("item and listing reads preserve numeric text, provenance, and bind search input", async () => {
  const attack = "%') OR 1=1 --";
  const h = harness((sql) => {
    if (sql.includes("api.searchItems")) {
      return { rows: [{
        id: "10000000-0000-0000-0000-000000000001",
        minecraft_id: "minecraft:diamond",
        display_name: "Diamond",
        variant_label: null,
        description: null,
        canonical_metadata: {},
        identity_state: "exact",
        lowest_ask: "1000.25",
        recent_sale_median: "950.5",
        sample_count: "12",
        active_listing_count: "2",
        recorded_sale_count: "12",
        confidence: "medium",
        freshness: "recent",
        completeness: "partial",
        gap_status: "none",
        total_count: "1",
      }] };
    }
    if (sql.includes("api.listListings")) {
      return { rows: [{
        id: "10",
        item_variant_id: "10000000-0000-0000-0000-000000000001",
        quantity: 4,
        total_ask_price: "4001.00",
        unit_ask_price: "1000.25",
        observed_at: new Date("2026-09-01T00:00:00Z"),
        approximate_expires_at: null,
        confidence: "medium",
        flags: {},
        snapshot_status: "complete",
        snapshot_consistency: "consistent",
        current_name: "Seller",
        source_seller_id: "seller-uuid",
        source_key: "mirror",
        source_type: "compatible_api",
        collector_version: "1",
        source_timestamp: null,
        freshness: "recent",
        completeness: "complete",
        total_count: "1",
      }] };
    }
    return { rows: [] };
  });
  const repository = new PostgresMarketRepository({ queryable: h.queryable, database: h.database });
  const found = await repository.searchItems({ query: attack, cursor: null, limit: 25 });
  assert.equal(found.items[0]?.lowestAsk, "1000.25");
  const searchCall = h.calls.find((call) => call.sql.includes("api.searchItems"));
  assert.ok(searchCall);
  assert.equal(searchCall.sql.includes(attack), false);
  assert.equal(String(searchCall.values[1]).includes("\\%"), true);

  const listings = await repository.listListings(found.items[0]?.id ?? "", { cursor: null, limit: 50 });
  assert.equal(listings.items[0]?.totalAsk, "4001.00");
  assert.equal(listings.items[0]?.seller.name, "Seller");
  assert.equal(listings.items[0]?.provenance.sourceId, "mirror");
});

test("watchlist creation uses one transaction and rejects unresolved item ids", async () => {
  let transactionCount = 0;
  const h = harness((sql) => {
    if (sql.includes("api.createWatchlist")) return { rows: [{
      id: "20000000-0000-0000-0000-000000000001",
      user_id: "00000000-0000-0000-0000-000000000001",
      name: "Tracked",
      created_at: new Date("2026-09-01T00:00:00Z"),
      updated_at: new Date("2026-09-01T00:00:00Z"),
    }] };
    if (sql.includes("api.resolveItem")) return { rows: [] };
    return { rows: [], rowCount: 1 };
  });
  const database = {
    ...h.database,
    async withTransaction<T>(operation: (client: Queryable) => Promise<T>): Promise<T> {
      transactionCount += 1;
      return operation(h.queryable);
    },
  };
  const repository = new PostgresMarketRepository({ queryable: h.queryable, database });
  await assert.rejects(
    repository.createWatchlist("00000000-0000-0000-0000-000000000001", { name: "Tracked", itemIds: ["unknown:item"] }),
    /Unknown watchlist item/,
  );
  assert.equal(transactionCount, 1);
  const resolver = h.calls.find((call) => call.sql.includes("api.resolveItem"));
  assert.deepEqual(resolver?.values, ["unknown:item"]);
});

test("outbox reads pass the caller's audience boundary and map known event types", async () => {
  const h = harness(() => ({ rows: [] }));
  h.database.readOutbox = async (cursor, _limit, audiences) => {
    h.outboxReads.push({ cursor, audiences });
    return [{
      cursor: "42",
      eventId: "30000000-0000-0000-0000-000000000001",
      aggregateType: "transaction",
      aggregateId: "40000000-0000-0000-0000-000000000001",
      eventType: "market.transaction.recorded",
      audience: "owner",
      payload: { itemId: "10000000-0000-0000-0000-000000000001" },
      occurredAt: new Date("2026-09-01T00:00:00Z"),
    }];
  };
  const repository = new PostgresMarketRepository({ queryable: h.queryable, database: h.database });
  const events = await repository.readOutbox("41", 10, ["owner"]);
  assert.deepEqual(h.outboxReads[0], { cursor: "41", audiences: ["owner"] });
  assert.equal(events[0]?.type, "sale.recorded");
  assert.equal(events[0]?.audience, "owner");
});
