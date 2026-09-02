import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { CSRF_COOKIE, SESSION_COOKIE } from "../src/auth.js";
import { buildApp } from "../src/app.js";
import type { ApiConfig } from "../src/config.js";
import type {
  DataQuality,
  ItemDetail,
  ListingRecord,
  Provenance,
  SaleRecord,
  StoredUser,
} from "../src/contracts.js";
import { InMemoryMarketRepository } from "../src/memory-repository.js";
import { hashPassword, verifyPassword } from "../src/security.js";

const allowedOrigin = "https://dashboard.example.test";
const ownerPassword = "correct horse battery staple";
const invitedPassword = "another secure invited password";

const quality: DataQuality = {
  freshness: "recent",
  confidence: "medium",
  sampleSize: 12,
  completeness: "partial",
  flags: ["recorded_volume_only"],
};

const provenance: Provenance = {
  sourceId: "compatible-api",
  sourceType: "compatible_api",
  observedAt: "2026-09-01T12:00:05.000Z",
  sourceTimestamp: "2026-09-01T12:00:00.000Z",
  collectorVersion: "test",
};

const item: ItemDetail = {
  id: "minecraft:diamond",
  baseItemId: "minecraft:diamond",
  displayName: "Diamond",
  variantLabel: null,
  identityState: "exact",
  lowestAsk: "1000",
  recentSaleMedian: "950",
  priceUnit: "server_currency",
  quality,
  description: "Ordinary diamond",
  metadata: {},
  recordedSaleCount: 1,
  activeListingCount: 1,
};

const listing: ListingRecord = {
  id: "listing-fingerprint-1",
  itemId: item.id,
  quantity: 4,
  totalAsk: "4000",
  unitAsk: "1000",
  priceUnit: "server_currency",
  observedAt: "2026-09-01T12:00:05.000Z",
  remainingSeconds: 600,
  seller: { name: "VisibleSeller", uuid: "00000000-0000-0000-0000-000000000001" },
  provenance,
  quality,
};

const sale: SaleRecord = {
  id: "sale-fingerprint-1",
  itemId: item.id,
  quantity: 2,
  totalSale: "1900",
  unitSale: "950",
  priceUnit: "server_currency",
  soldAt: "2026-09-01T11:55:00.000Z",
  ingestedAt: "2026-09-01T11:55:03.000Z",
  seller: { name: "VisibleSeller", uuid: "00000000-0000-0000-0000-000000000001" },
  provenance,
  quality,
};

interface BrowserAuth {
  cookie: string;
  csrf: string;
  rawSession: string;
}

let app: FastifyInstance;
let repository: InMemoryMarketRepository;
let ownerAuth: BrowserAuth;
let invitedAuth: BrowserAuth;

const config: ApiConfig = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 3001,
  allowedOrigins: [allowedOrigin],
  cookieSecure: true,
  sessionTtlMs: 3_600_000,
  tokenHashSecret: "test-token-hash-secret-that-is-long-enough",
  sellerPseudonymSecret: "test-seller-pseudonym-secret-long-enough",
  metricsBearerToken: "test-metrics-bearer-token-long-enough",
  ownerUsername: "owner",
  ownerPasswordHash: "unused-by-injected-repository",
  exposeOpenApi: true,
  requestBodyLimitBytes: 65_536,
  globalRateLimitPerMinute: 1_000,
  loginRateLimitPerMinute: 20,
};

function setCookieValues(response: LightMyRequestResponse): string[] {
  const value = response.headers["set-cookie"];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function cookieValue(response: LightMyRequestResponse, name: string): string {
  const prefix = `${name}=`;
  for (const value of setCookieValues(response)) {
    const pair = value.split(";", 1)[0];
    if (pair?.startsWith(prefix)) return pair.slice(prefix.length);
  }
  throw new Error(`Missing ${name} cookie`);
}

async function login(username: string, password: string): Promise<BrowserAuth> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    headers: { origin: allowedOrigin },
    payload: { username, password },
  });
  assert.equal(response.statusCode, 200, response.body);
  const rawSession = cookieValue(response, SESSION_COOKIE);
  const csrf = cookieValue(response, CSRF_COOKIE);
  return {
    rawSession,
    csrf,
    cookie: `${SESSION_COOKIE}=${rawSession}; ${CSRF_COOKIE}=${csrf}`,
  };
}

function mutationHeaders(auth: BrowserAuth) {
  return {
    cookie: auth.cookie,
    origin: allowedOrigin,
    "x-csrf-token": auth.csrf,
  };
}

before(async () => {
  const users: StoredUser[] = [
    {
      user: { id: "owner-user", username: "owner", role: "owner", sellerPrivacy: "full" },
      passwordHash: await hashPassword(ownerPassword),
    },
    {
      user: { id: "invited-user", username: "friend", role: "invited", sellerPrivacy: "hidden" },
      passwordHash: await hashPassword(invitedPassword),
    },
  ];
  repository = new InMemoryMarketRepository({
    users,
    items: [item],
    listings: [listing],
    sales: [sale],
    history: {
      [item.id]: [
        {
          start: "2026-09-01T11:00:00.000Z",
          end: "2026-09-01T12:00:00.000Z",
          interval: "hour",
          open: "900",
          high: "1000",
          low: "900",
          close: "950",
          median: "950",
          mean: "950",
          quantityWeightedMean: "950",
          tradeCount: 1,
          recordedQuantity: 2,
          recordedTurnover: "1900",
          lowestAsk: "1000",
          activeListingCount: 1,
          gap: false,
          quality,
          provenance: [provenance],
        },
      ],
    },
    sources: [
      {
        id: "compatible-api",
        type: "completed_auction_transactions",
        displayName: "Compatible API",
        enabled: true,
        trust: "primary",
        status: "healthy",
        lastSuccessAt: "2026-09-01T12:00:05.000Z",
        lastFailureAt: null,
        lastErrorCode: null,
        requestLatencyMs: 42,
        freshness: "live",
      },
    ],
    outbox: [
      {
        cursor: "1",
        audience: "authenticated",
        type: "listing.changed",
        occurredAt: "2026-09-01T12:00:05.000Z",
        payload: {
          itemId: item.id,
          seller: listing.seller,
          sellerUuid: listing.seller.uuid,
          password: "must-never-serialize",
        },
      },
    ],
  });
  app = await buildApp({ repository, config, logger: false });
  await app.ready();
  ownerAuth = await login("owner", ownerPassword);
  invitedAuth = await login("friend", invitedPassword);
});

after(async () => {
  await app.close();
});

describe("system and error behavior", () => {
  test("liveness, readiness, CSP, OpenAPI, and stable not-found errors", async () => {
    const live = await app.inject({ method: "GET", url: "/health/live" });
    assert.equal(live.statusCode, 200);
    assert.match(String(live.headers["content-security-policy"]), /default-src 'none'/);

    const ready = await app.inject({ method: "GET", url: "/health/ready" });
    assert.equal(ready.statusCode, 200);
    assert.equal(ready.json().status, "ready");

    const openapi = await app.inject({ method: "GET", url: "/openapi.json" });
    assert.equal(openapi.statusCode, 200);
    assert.ok(openapi.json().paths["/v1/items/{itemId}/listings"]);

    const missing = await app.inject({ method: "GET", url: "/no-such-route" });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().error.code, "ROUTE_NOT_FOUND");
    assert.equal(typeof missing.json().error.requestId, "string");
  });

  test("readiness reports dependency failure", async () => {
    repository.setReady(false);
    const response = await app.inject({ method: "GET", url: "/health/ready" });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().checks.repository, "not_ready");
    repository.setReady(true);
  });

  test("metrics require a separate bearer secret", async () => {
    const rejected = await app.inject({ method: "GET", url: "/metrics" });
    assert.equal(rejected.statusCode, 401);
    assert.equal(rejected.json().error.code, "METRICS_AUTHENTICATION_REQUIRED");

    const accepted = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: { authorization: `Bearer ${config.metricsBearerToken}` },
    });
    assert.equal(accepted.statusCode, 200);
    assert.match(accepted.body, /donut_api_requests_total/);
  });
});

describe("authentication and request protection", () => {
  test("uses scrypt password hashes and rejects bad origin or credentials", async () => {
    const encoded = await hashPassword("a third sufficiently long password");
    assert.equal(await verifyPassword("a third sufficiently long password", encoded), true);
    assert.equal(await verifyPassword("not the password", encoded), false);

    const badOrigin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { origin: "https://evil.example" },
      payload: { username: "owner", password: ownerPassword },
    });
    assert.equal(badOrigin.statusCode, 403);
    assert.equal(badOrigin.json().error.code, "ORIGIN_NOT_ALLOWED");

    const badPassword = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { origin: allowedOrigin },
      payload: { username: "owner", password: "incorrect" },
    });
    assert.equal(badPassword.statusCode, 401);
    assert.equal(badPassword.json().error.code, "INVALID_CREDENTIALS");
  });

  test("stores only a keyed hash of the revocable session token", () => {
    const sessions = repository.sessionSnapshot();
    const ownerSession = sessions.find((session) => session.userId === "owner-user");
    assert.ok(ownerSession);
    assert.notEqual(ownerSession.tokenHash, ownerAuth.rawSession);
    assert.match(ownerSession.tokenHash, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(ownerSession).includes(ownerAuth.rawSession), false);
  });

  test("requires a session, exact origin, and double-submit CSRF for mutations", async () => {
    const noAuth = await app.inject({ method: "GET", url: "/v1/market/overview" });
    assert.equal(noAuth.statusCode, 401);

    const noOrigin = await app.inject({
      method: "POST",
      url: "/v1/watchlists",
      headers: { cookie: ownerAuth.cookie, "x-csrf-token": ownerAuth.csrf },
      payload: { name: "Diamonds", itemIds: [item.id] },
    });
    assert.equal(noOrigin.statusCode, 403);
    assert.equal(noOrigin.json().error.code, "ORIGIN_NOT_ALLOWED");

    const noCsrf = await app.inject({
      method: "POST",
      url: "/v1/watchlists",
      headers: { cookie: ownerAuth.cookie, origin: allowedOrigin },
      payload: { name: "Diamonds", itemIds: [item.id] },
    });
    assert.equal(noCsrf.statusCode, 403);
    assert.equal(noCsrf.json().error.code, "CSRF_VALIDATION_FAILED");

    const created = await app.inject({
      method: "POST",
      url: "/v1/watchlists",
      headers: mutationHeaders(ownerAuth),
      payload: { name: "Diamonds", itemIds: [item.id] },
    });
    assert.equal(created.statusCode, 201, created.body);
    const listed = await app.inject({
      method: "GET",
      url: "/v1/watchlists",
      headers: { cookie: ownerAuth.cookie },
    });
    assert.equal(listed.json().watchlists.length, 1);
  });

  test("rejects unknown properties with the stable validation envelope", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/watchlists",
      headers: mutationHeaders(ownerAuth),
      payload: { name: "Nope", itemIds: [], surprise: true },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, "INVALID_REQUEST");
  });
});

describe("market resources and privacy", () => {
  test("keeps active asks, sales, explicit units, provenance, and history separate", async () => {
    const headers = { cookie: ownerAuth.cookie };
    const search = await app.inject({ method: "GET", url: "/v1/items?query=diamond", headers });
    assert.equal(search.statusCode, 200);
    assert.equal(search.json().items[0].id, item.id);

    const asks = await app.inject({ method: "GET", url: `/v1/items/${encodeURIComponent(item.id)}/listings`, headers });
    assert.equal(asks.statusCode, 200, asks.body);
    assert.equal(asks.json().items[0].totalAsk, "4000");
    assert.equal(asks.json().items[0].totalSale, undefined);
    assert.equal(asks.json().items[0].priceUnit, "server_currency");
    assert.equal(asks.json().items[0].seller.display, "full");

    const sales = await app.inject({ method: "GET", url: `/v1/items/${encodeURIComponent(item.id)}/sales`, headers });
    assert.equal(sales.statusCode, 200);
    assert.equal(sales.json().items[0].totalSale, "1900");
    assert.equal(sales.json().items[0].buyer, undefined);

    const history = await app.inject({
      method: "GET",
      url: `/v1/items/${encodeURIComponent(item.id)}/history?from=2026-09-01T10%3A00%3A00.000Z&to=2026-09-01T13%3A00%3A00.000Z&interval=hour`,
      headers,
    });
    assert.equal(history.statusCode, 200, history.body);
    assert.equal(history.json().points[0].gap, false);
    assert.equal(history.json().points[0].recordedQuantity, 2);
  });

  test("applies invited-user seller policy before response serialization", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/v1/items/${encodeURIComponent(item.id)}/listings`,
      headers: { cookie: invitedAuth.cookie },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().items[0].seller, { display: "hidden" });
    assert.equal(response.body.includes("VisibleSeller"), false);
    assert.equal(response.body.includes("00000000-0000"), false);
  });

  test("reports unsupported Orders, shop prices, and fees honestly", async () => {
    const headers = { cookie: ownerAuth.cookie };
    const features = await app.inject({ method: "GET", url: "/v1/features", headers });
    const byId = Object.fromEntries(features.json().features.map((feature: { id: string; state: string }) => [feature.id, feature.state]));
    assert.equal(byId.orders, "unavailable");
    assert.equal(byId.shop_prices, "unavailable");
    assert.equal(byId.fees, "unknown");
    assert.equal(byId.automated_actions, "disabled");

    const orders = await app.inject({ method: "GET", url: "/v1/orders", headers });
    assert.equal(orders.statusCode, 501);
    assert.equal(orders.json().error.code, "FEATURE_UNAVAILABLE");
  });
});

describe("personal resources, export, live cursor, and mod access", () => {
  test("creates validated alerts and dashboards", async () => {
    const alert = await app.inject({
      method: "POST",
      url: "/v1/alerts",
      headers: mutationHeaders(ownerAuth),
      payload: { name: "Cheap diamonds", type: "ask_below", itemId: item.id, threshold: "900", cooldownSeconds: 300 },
    });
    assert.equal(alert.statusCode, 201, alert.body);

    const dashboard = await app.inject({
      method: "POST",
      url: "/v1/dashboards",
      headers: mutationHeaders(ownerAuth),
      payload: {
        name: "Main",
        theme: "dark",
        density: "compact",
        cards: [{ id: "diamond-card", type: "price_chart", itemId: item.id, metric: "median", x: 0, y: 0, width: 6, height: 4 }],
      },
    });
    assert.equal(dashboard.statusCode, 201, dashboard.body);
  });

  test("exports source-aware data and sanitizes resumable outbox payloads", async () => {
    const exported = await app.inject({
      method: "GET",
      url: "/v1/export",
      headers: { cookie: ownerAuth.cookie },
    });
    assert.equal(exported.statusCode, 200);
    assert.match(String(exported.headers["content-disposition"]), /attachment/);
    assert.equal(exported.json().notices.length, 3);
    assert.equal(exported.json().sales[0].seller.display, "full");

    const invitedEvents = await app.inject({
      method: "GET",
      url: "/v1/events?cursor=0",
      headers: { cookie: invitedAuth.cookie },
    });
    assert.equal(invitedEvents.statusCode, 200);
    assert.deepEqual(invitedEvents.json().events[0].payload.seller, { display: "hidden" });
    assert.equal(invitedEvents.body.includes("VisibleSeller"), false);
    assert.equal(invitedEvents.body.includes("must-never-serialize"), false);
    assert.equal(invitedEvents.json().nextCursor, "1");
  });

  test("issues scoped, hashed, revocable mod tokens without any upstream key", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/mod-tokens",
      headers: mutationHeaders(ownerAuth),
      payload: { label: "Test client", scopes: ["market:read", "stream:read"], expirationDays: 30 },
    });
    assert.equal(created.statusCode, 201, created.body);
    const body = created.json();
    assert.match(body.token, /^dnt_mod_/);
    assert.equal(created.body.toLowerCase().includes("upstream_api_key"), false);

    const listed = await app.inject({
      method: "GET",
      url: "/v1/mod-tokens",
      headers: { cookie: ownerAuth.cookie },
    });
    assert.equal(listed.statusCode, 200);
    assert.equal(listed.body.includes("tokenHash"), false);
    assert.equal(listed.body.includes(body.token), false);

    const market = await app.inject({
      method: "GET",
      url: "/v1/market/overview",
      headers: { authorization: `Bearer ${body.token}` },
    });
    assert.equal(market.statusCode, 200, market.body);

    const mutateWithMod = await app.inject({
      method: "POST",
      url: "/v1/watchlists",
      headers: { authorization: `Bearer ${body.token}`, origin: allowedOrigin, "x-csrf-token": "not-applicable" },
      payload: { name: "Forbidden", itemIds: [] },
    });
    assert.equal(mutateWithMod.statusCode, 403);
    assert.equal(mutateWithMod.json().error.code, "SESSION_REQUIRED");

    const revoked = await app.inject({
      method: "DELETE",
      url: `/v1/mod-tokens/${body.id}`,
      headers: mutationHeaders(ownerAuth),
    });
    assert.equal(revoked.statusCode, 204);

    const afterRevoke = await app.inject({
      method: "GET",
      url: "/v1/market/overview",
      headers: { authorization: `Bearer ${body.token}` },
    });
    assert.equal(afterRevoke.statusCode, 401);
  });
});
