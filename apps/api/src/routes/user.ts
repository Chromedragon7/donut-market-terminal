import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { AuthService } from "../auth.js";
import type {
  AlertType,
  CreateAlertInput,
  CreateDashboardInput,
  CreateWatchlistInput,
  DashboardCard,
  MarketRepository,
  ModScope,
} from "../contracts.js";
import { sendError } from "../errors.js";
import { serializeExport } from "../serializers.js";
import { createOpaqueToken, hashOpaqueToken } from "../security.js";
import type { ApiConfig } from "../config.js";

interface IdParams {
  id: string;
}

interface WatchlistBody {
  name: string;
  itemIds: string[];
}

interface AlertBody {
  name: string;
  type: AlertType;
  itemId?: string | null;
  threshold?: string | null;
  percentage?: number | null;
  cooldownSeconds?: number;
  enabled?: boolean;
}

interface DashboardBody {
  name: string;
  cards: DashboardCard[];
  theme?: "system" | "light" | "dark";
  density?: "compact" | "comfortable";
}

interface ModTokenBody {
  label: string;
  scopes: ModScope[];
  expirationDays?: number;
}

const idParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { id: { type: "string", minLength: 1, maxLength: 100, pattern: "^[A-Za-z0-9_-]+$" } },
} as const;

const watchlistBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "itemIds"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 80 },
    itemIds: {
      type: "array",
      maxItems: 500,
      uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 200, pattern: "^[A-Za-z0-9:_.~-]+$" },
    },
  },
} as const;

const nullableItemId = {
  anyOf: [
    { type: "string", minLength: 1, maxLength: 200, pattern: "^[A-Za-z0-9:_.~-]+$" },
    { type: "null" },
  ],
} as const;

const nullableAmount = {
  anyOf: [
    { type: "string", minLength: 1, maxLength: 64, pattern: "^[0-9]+(?:\\.[0-9]+)?$" },
    { type: "null" },
  ],
} as const;

const nullablePercentage = {
  anyOf: [{ type: "number", minimum: 0, maximum: 10_000 }, { type: "null" }],
} as const;

const alertBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "type"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 100 },
    type: {
      type: "string",
      enum: [
        "ask_below",
        "ask_below_median_percent",
        "sale_threshold",
        "price_movement",
        "volume_spike",
        "supply_change",
        "new_variant",
        "source_stale",
        "collector_failure",
        "historical_gap",
        "low_confidence",
      ],
    },
    itemId: nullableItemId,
    threshold: nullableAmount,
    percentage: nullablePercentage,
    cooldownSeconds: { type: "integer", minimum: 30, maximum: 2_592_000 },
    enabled: { type: "boolean" },
  },
} as const;

const cardSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "type", "itemId", "metric", "x", "y", "width", "height"],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 80, pattern: "^[A-Za-z0-9_-]+$" },
    type: { type: "string", enum: ["market_summary", "item_price", "price_chart", "volume", "supply", "source_health", "watchlist"] },
    itemId: nullableItemId,
    metric: { anyOf: [{ type: "string", minLength: 1, maxLength: 80 }, { type: "null" }] },
    x: { type: "integer", minimum: 0, maximum: 100 },
    y: { type: "integer", minimum: 0, maximum: 10_000 },
    width: { type: "integer", minimum: 1, maximum: 12 },
    height: { type: "integer", minimum: 1, maximum: 20 },
  },
} as const;

const dashboardBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "cards"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 100 },
    cards: { type: "array", maxItems: 100, items: cardSchema },
    theme: { type: "string", enum: ["system", "light", "dark"] },
    density: { type: "string", enum: ["compact", "comfortable"] },
  },
} as const;

function normalizeAlert(body: AlertBody): CreateAlertInput {
  return {
    name: body.name,
    type: body.type,
    itemId: body.itemId ?? null,
    threshold: body.threshold ?? null,
    percentage: body.percentage ?? null,
    cooldownSeconds: body.cooldownSeconds ?? 300,
    enabled: body.enabled ?? true,
  };
}

function alertValidationMessage(input: CreateAlertInput): string | null {
  if (["ask_below", "sale_threshold"].includes(input.type) && input.threshold === null) {
    return `${input.type} requires threshold`;
  }
  if (["ask_below_median_percent", "price_movement", "volume_spike", "supply_change"].includes(input.type) && input.percentage === null) {
    return `${input.type} requires percentage`;
  }
  if (["ask_below", "ask_below_median_percent", "sale_threshold", "price_movement", "volume_spike", "supply_change", "new_variant", "low_confidence"].includes(input.type) && input.itemId === null) {
    return `${input.type} requires itemId`;
  }
  return null;
}

function normalizeDashboard(body: DashboardBody): CreateDashboardInput {
  return {
    name: body.name,
    cards: body.cards,
    theme: body.theme ?? "system",
    density: body.density ?? "comfortable",
  };
}

function hasDuplicateCardIds(cards: DashboardCard[]): boolean {
  return new Set(cards.map((card) => card.id)).size !== cards.length;
}

export function registerUserRoutes(
  app: FastifyInstance,
  repository: MarketRepository,
  auth: AuthService,
  config: ApiConfig,
): void {
  const readSession = auth.requireAuth(undefined, true);
  const mutate = [readSession, auth.requireAllowedOrigin, auth.requireCsrf];

  app.get(
    "/v1/watchlists",
    { schema: { tags: ["personal"], summary: "List personal watchlists" }, preHandler: readSession },
    async (request) => ({ watchlists: await repository.listWatchlists(auth.context(request).user.id) }),
  );

  app.post<{ Body: WatchlistBody }>(
    "/v1/watchlists",
    { schema: { tags: ["personal"], summary: "Create a watchlist", body: watchlistBodySchema }, preHandler: mutate },
    async (request, reply) => reply.code(201).send(await repository.createWatchlist(
      auth.context(request).user.id,
      request.body as CreateWatchlistInput,
    )),
  );

  app.put<{ Params: IdParams; Body: WatchlistBody }>(
    "/v1/watchlists/:id",
    { schema: { tags: ["personal"], summary: "Replace a watchlist", params: idParamsSchema, body: watchlistBodySchema }, preHandler: mutate },
    async (request, reply) => {
      const value = await repository.updateWatchlist(auth.context(request).user.id, request.params.id, request.body);
      return value ?? sendError(request, reply, 404, "WATCHLIST_NOT_FOUND", "Watchlist was not found");
    },
  );

  app.delete<{ Params: IdParams }>(
    "/v1/watchlists/:id",
    { schema: { tags: ["personal"], summary: "Delete a watchlist", params: idParamsSchema }, preHandler: mutate },
    async (request, reply) => {
      if (!(await repository.deleteWatchlist(auth.context(request).user.id, request.params.id))) {
        return sendError(request, reply, 404, "WATCHLIST_NOT_FOUND", "Watchlist was not found");
      }
      return reply.code(204).send();
    },
  );

  app.get(
    "/v1/alerts",
    { schema: { tags: ["personal"], summary: "List personal alert rules" }, preHandler: readSession },
    async (request) => ({ alerts: await repository.listAlerts(auth.context(request).user.id) }),
  );

  app.post<{ Body: AlertBody }>(
    "/v1/alerts",
    { schema: { tags: ["personal"], summary: "Create a deduplicated/cooldown-capable alert rule", body: alertBodySchema }, preHandler: mutate },
    async (request, reply) => {
      const input = normalizeAlert(request.body);
      const validation = alertValidationMessage(input);
      if (validation !== null) return sendError(request, reply, 400, "INVALID_ALERT_RULE", validation);
      return reply.code(201).send(await repository.createAlert(auth.context(request).user.id, input));
    },
  );

  app.put<{ Params: IdParams; Body: AlertBody }>(
    "/v1/alerts/:id",
    { schema: { tags: ["personal"], summary: "Replace an alert rule", params: idParamsSchema, body: alertBodySchema }, preHandler: mutate },
    async (request, reply) => {
      const input = normalizeAlert(request.body);
      const validation = alertValidationMessage(input);
      if (validation !== null) return sendError(request, reply, 400, "INVALID_ALERT_RULE", validation);
      const value = await repository.updateAlert(auth.context(request).user.id, request.params.id, input);
      return value ?? sendError(request, reply, 404, "ALERT_NOT_FOUND", "Alert rule was not found");
    },
  );

  app.delete<{ Params: IdParams }>(
    "/v1/alerts/:id",
    { schema: { tags: ["personal"], summary: "Delete an alert rule", params: idParamsSchema }, preHandler: mutate },
    async (request, reply) => {
      if (!(await repository.deleteAlert(auth.context(request).user.id, request.params.id))) {
        return sendError(request, reply, 404, "ALERT_NOT_FOUND", "Alert rule was not found");
      }
      return reply.code(204).send();
    },
  );

  app.get(
    "/v1/dashboards",
    { schema: { tags: ["personal"], summary: "List personal dashboard layouts" }, preHandler: readSession },
    async (request) => ({ dashboards: await repository.listDashboards(auth.context(request).user.id) }),
  );

  app.post<{ Body: DashboardBody }>(
    "/v1/dashboards",
    { schema: { tags: ["personal"], summary: "Create a custom dashboard", body: dashboardBodySchema }, preHandler: mutate },
    async (request, reply) => {
      if (hasDuplicateCardIds(request.body.cards)) {
        return sendError(request, reply, 400, "DUPLICATE_CARD_ID", "Dashboard card ids must be unique");
      }
      return reply.code(201).send(await repository.createDashboard(
        auth.context(request).user.id,
        normalizeDashboard(request.body),
      ));
    },
  );

  app.put<{ Params: IdParams; Body: DashboardBody }>(
    "/v1/dashboards/:id",
    { schema: { tags: ["personal"], summary: "Replace a dashboard", params: idParamsSchema, body: dashboardBodySchema }, preHandler: mutate },
    async (request, reply) => {
      if (hasDuplicateCardIds(request.body.cards)) {
        return sendError(request, reply, 400, "DUPLICATE_CARD_ID", "Dashboard card ids must be unique");
      }
      const value = await repository.updateDashboard(
        auth.context(request).user.id,
        request.params.id,
        normalizeDashboard(request.body),
      );
      return value ?? sendError(request, reply, 404, "DASHBOARD_NOT_FOUND", "Dashboard was not found");
    },
  );

  app.delete<{ Params: IdParams }>(
    "/v1/dashboards/:id",
    { schema: { tags: ["personal"], summary: "Delete a dashboard", params: idParamsSchema }, preHandler: mutate },
    async (request, reply) => {
      if (!(await repository.deleteDashboard(auth.context(request).user.id, request.params.id))) {
        return sendError(request, reply, 404, "DASHBOARD_NOT_FOUND", "Dashboard was not found");
      }
      return reply.code(204).send();
    },
  );

  app.get(
    "/v1/export",
    { schema: { tags: ["personal"], summary: "Export retained personal market data as JSON" }, preHandler: readSession },
    async (request, reply) => {
      const bundle = await repository.exportUserData(auth.context(request).user.id);
      const date = new Date().toISOString().slice(0, 10);
      reply.header("content-disposition", `attachment; filename=\"donut-market-export-${date}.json\"`);
      return serializeExport(bundle, auth.privacyContext(request));
    },
  );

  app.get(
    "/v1/mod-tokens",
    { schema: { tags: ["personal"], summary: "List revocable read-only mod tokens without their hashes" }, preHandler: readSession },
    async (request) => {
      const values = await repository.listModTokens(auth.context(request).user.id);
      return {
        tokens: values.map(({ tokenHash: _tokenHash, userId: _userId, ...safe }) => safe),
      };
    },
  );

  app.post<{ Body: ModTokenBody }>(
    "/v1/mod-tokens",
    {
      schema: {
        tags: ["personal"],
        summary: "Issue a read-only backend token for the Minecraft mod; returned once",
        body: {
          type: "object",
          additionalProperties: false,
          required: ["label", "scopes"],
          properties: {
            label: { type: "string", minLength: 1, maxLength: 80 },
            scopes: { type: "array", minItems: 1, maxItems: 2, uniqueItems: true, items: { type: "string", enum: ["market:read", "stream:read"] } },
            expirationDays: { type: "integer", minimum: 1, maximum: 365 },
          },
        },
      },
      preHandler: mutate,
    },
    async (request, reply) => {
      const id = randomUUID();
      const rawToken = `dnt_mod_${createOpaqueToken()}`;
      const createdAt = new Date();
      const expiresAt = new Date(createdAt.getTime() + (request.body.expirationDays ?? 90) * 86_400_000);
      await repository.createModToken({
        id,
        userId: auth.context(request).user.id,
        label: request.body.label,
        tokenHash: hashOpaqueToken(rawToken, config.tokenHashSecret),
        scopes: [...request.body.scopes],
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      });
      return reply.code(201).send({
        id,
        label: request.body.label,
        scopes: request.body.scopes,
        token: rawToken,
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        warning: "This token is shown once. It never grants access to the upstream API key.",
      });
    },
  );

  app.delete<{ Params: IdParams }>(
    "/v1/mod-tokens/:id",
    { schema: { tags: ["personal"], summary: "Revoke a Minecraft mod token", params: idParamsSchema }, preHandler: mutate },
    async (request, reply) => {
      if (!(await repository.revokeModToken(auth.context(request).user.id, request.params.id, new Date().toISOString()))) {
        return sendError(request, reply, 404, "MOD_TOKEN_NOT_FOUND", "Mod token was not found");
      }
      return reply.code(204).send();
    },
  );
}
