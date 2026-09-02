import type { FastifyInstance } from "fastify";
import type { AuthService } from "../auth.js";
import type { HistoryPoint, MarketRepository } from "../contracts.js";
import { sendError } from "../errors.js";
import { serializeListing, serializeSale } from "../serializers.js";

interface PaginationQuery {
  cursor?: string;
  limit?: number;
}

interface SearchQuery extends PaginationQuery {
  query?: string;
}

interface ItemParams {
  itemId: string;
}

interface HistoryQuery {
  from?: string;
  to?: string;
  interval?: HistoryPoint["interval"];
  includeOutliers?: boolean;
}

const paginationProperties = {
  cursor: { type: "string", minLength: 1, maxLength: 128 },
  limit: { type: "integer", minimum: 1, maximum: 100 },
} as const;

const paginationQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: paginationProperties,
} as const;

const itemParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["itemId"],
  properties: {
    itemId: { type: "string", minLength: 1, maxLength: 200, pattern: "^[A-Za-z0-9:_.~-]+$" },
  },
} as const;

async function itemExists(repository: MarketRepository, itemId: string): Promise<boolean> {
  return (await repository.getItem(itemId)) !== null;
}

export function registerMarketRoutes(
  app: FastifyInstance,
  repository: MarketRepository,
  auth: AuthService,
): void {
  app.get(
    "/v1/market/overview",
    {
      schema: { tags: ["market"], summary: "Separate active-ask and completed-sale summaries" },
      preHandler: auth.requireAuth("market:read"),
    },
    async () => repository.getMarketOverview(),
  );

  app.get<{ Querystring: SearchQuery }>(
    "/v1/items",
    {
      schema: {
        tags: ["market"],
        summary: "Search canonical items and variants",
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            query: { type: "string", maxLength: 120 },
            ...paginationProperties,
          },
        },
      },
      preHandler: auth.requireAuth("market:read"),
    },
    async (request) => repository.searchItems({
      query: request.query.query ?? "",
      cursor: request.query.cursor ?? null,
      limit: request.query.limit ?? 25,
    }),
  );

  app.get<{ Params: ItemParams }>(
    "/v1/items/:itemId",
    {
      schema: { tags: ["market"], summary: "Get one item or variant", params: itemParamsSchema },
      preHandler: auth.requireAuth("market:read"),
    },
    async (request, reply) => {
      const item = await repository.getItem(request.params.itemId);
      if (item === null) return sendError(request, reply, 404, "ITEM_NOT_FOUND", "Item was not found");
      return item;
    },
  );

  app.get<{ Params: ItemParams; Querystring: PaginationQuery }>(
    "/v1/items/:itemId/listings",
    {
      schema: {
        tags: ["market"],
        summary: "Get active asking prices; these are not completed sales",
        params: itemParamsSchema,
        querystring: paginationQuerySchema,
      },
      preHandler: auth.requireAuth("market:read"),
    },
    async (request, reply) => {
      if (!(await itemExists(repository, request.params.itemId))) {
        return sendError(request, reply, 404, "ITEM_NOT_FOUND", "Item was not found");
      }
      const result = await repository.listListings(request.params.itemId, {
        cursor: request.query.cursor ?? null,
        limit: request.query.limit ?? 50,
      });
      const privacy = auth.privacyContext(request);
      return { ...result, items: result.items.map((record) => serializeListing(record, privacy)) };
    },
  );

  app.get<{ Params: ItemParams; Querystring: PaginationQuery }>(
    "/v1/items/:itemId/sales",
    {
      schema: {
        tags: ["market"],
        summary: "Get recorded completed sales; recorded volume may be incomplete",
        params: itemParamsSchema,
        querystring: paginationQuerySchema,
      },
      preHandler: auth.requireAuth("market:read"),
    },
    async (request, reply) => {
      if (!(await itemExists(repository, request.params.itemId))) {
        return sendError(request, reply, 404, "ITEM_NOT_FOUND", "Item was not found");
      }
      const result = await repository.listSales(request.params.itemId, {
        cursor: request.query.cursor ?? null,
        limit: request.query.limit ?? 50,
      });
      const privacy = auth.privacyContext(request);
      return { ...result, items: result.items.map((record) => serializeSale(record, privacy)) };
    },
  );

  app.get<{ Params: ItemParams; Querystring: HistoryQuery }>(
    "/v1/items/:itemId/history",
    {
      schema: {
        tags: ["market"],
        summary: "Get bounded aggregate history with explicit gaps and provenance",
        params: itemParamsSchema,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            from: { type: "string", format: "date-time" },
            to: { type: "string", format: "date-time" },
            interval: { type: "string", enum: ["minute", "five_minute", "hour", "day", "week"] },
            includeOutliers: { type: "boolean" },
          },
        },
      },
      preHandler: auth.requireAuth("market:read"),
    },
    async (request, reply) => {
      if (!(await itemExists(repository, request.params.itemId))) {
        return sendError(request, reply, 404, "ITEM_NOT_FOUND", "Item was not found");
      }
      const to = request.query.to ?? new Date().toISOString();
      const from = request.query.from ?? new Date(Date.parse(to) - 24 * 60 * 60 * 1000).toISOString();
      if (Date.parse(from) >= Date.parse(to)) {
        return sendError(request, reply, 400, "INVALID_TIME_RANGE", "from must be earlier than to");
      }
      const points = await repository.getHistory(request.params.itemId, {
        from,
        to,
        interval: request.query.interval ?? "hour",
        includeOutliers: request.query.includeOutliers ?? false,
      });
      return { itemId: request.params.itemId, from, to, points };
    },
  );

  app.get(
    "/v1/sources",
    {
      schema: { tags: ["operations"], summary: "Get provider availability and freshness" },
      preHandler: auth.requireAuth("market:read"),
    },
    async () => ({ sources: await repository.listSources() }),
  );

  app.get(
    "/v1/collection-health",
    {
      schema: { tags: ["operations"], summary: "Get owner-only collector, gap, and backup health" },
      preHandler: [auth.requireAuth(undefined, true), auth.requireOwner],
    },
    async () => repository.getCollectionHealth(),
  );

  app.get(
    "/v1/features",
    {
      schema: { tags: ["market"], summary: "Get honest supported, disabled, unavailable, and unknown states" },
      preHandler: auth.requireAuth("market:read"),
    },
    async () => ({ features: await repository.listFeatures() }),
  );

  for (const [path, feature, message] of [
    ["/v1/orders", "orders", "Orders are unavailable because no verified provider exists"],
    ["/v1/shop-prices", "shop_prices", "Shop/base prices are unavailable because no verified provider exists"],
    ["/v1/fees", "fees", "Fee rules are unknown until effective-dated evidence is configured"],
  ] as const) {
    app.get(
      path,
      {
        schema: { tags: ["future"], summary: `Report ${feature} as unavailable or unknown` },
        preHandler: auth.requireAuth("market:read"),
      },
      async (request, reply) => sendError(
        request,
        reply,
        501,
        "FEATURE_UNAVAILABLE",
        message,
        { feature },
      ),
    );
  }
}
