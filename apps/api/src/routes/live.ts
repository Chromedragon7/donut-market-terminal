import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { AuthService } from "../auth.js";
import type { ApiConfig } from "../config.js";
import type { MarketRepository, OutboxEvent } from "../contracts.js";
import { sendError } from "../errors.js";
import type { ApiMetrics } from "../metrics.js";
import { serializeOutboxEvent, type PrivacyContext } from "../serializers.js";

interface EventQuery {
  cursor?: string;
  limit?: number;
}

const eventQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    cursor: { type: "string", minLength: 1, maxLength: 128, pattern: "^[0-9]+$" },
    limit: { type: "integer", minimum: 1, maximum: 100 },
  },
} as const;

function writeEvent(reply: FastifyReply, event: OutboxEvent, privacy: PrivacyContext): boolean {
  const safe = serializeOutboxEvent(event, privacy);
  return reply.raw.write(
    `id: ${safe.cursor}\nevent: ${safe.type}\ndata: ${JSON.stringify(safe)}\n\n`,
  );
}

function permittedAudiences(auth: AuthService, request: FastifyRequest): OutboxEvent["audience"][] {
  return auth.context(request).user.role === "owner"
    ? ["owner", "authenticated"]
    : ["authenticated"];
}

export function registerLiveRoutes(
  app: FastifyInstance,
  repository: MarketRepository,
  auth: AuthService,
  metrics: ApiMetrics,
  config: ApiConfig,
): void {
  app.get<{ Querystring: EventQuery }>(
    "/v1/events",
    {
      schema: {
        tags: ["live"],
        summary: "Read a bounded outbox page after an opaque resume cursor",
        querystring: eventQuerySchema,
      },
      preHandler: auth.requireAuth("stream:read"),
    },
    async (request) => {
      const events = await repository.readOutbox(
        request.query.cursor ?? null,
        request.query.limit ?? 100,
        permittedAudiences(auth, request),
      );
      const privacy = auth.privacyContext(request);
      return {
        events: events.map((event) => serializeOutboxEvent(event, privacy)),
        nextCursor: events.at(-1)?.cursor ?? request.query.cursor ?? null,
      };
    },
  );

  const streamOrigin: preHandlerHookHandler = async (request, reply) => {
    const origin = request.headers.origin?.replace(/\/$/, "");
    if (origin !== undefined && !config.allowedOrigins.includes(origin)) {
      sendError(request, reply, 403, "ORIGIN_NOT_ALLOWED", "This stream origin is not allowed");
    }
  };

  app.get<{ Querystring: Pick<EventQuery, "cursor"> }>(
    "/v1/stream",
    {
      schema: {
        tags: ["live"],
        summary: "Open an authenticated resumable server-sent event stream",
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { cursor: eventQuerySchema.properties.cursor },
        },
      },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      preHandler: [auth.requireAuth("stream:read"), streamOrigin],
    },
    async (request, reply) => {
      const headerCursor = typeof request.headers["last-event-id"] === "string"
        ? request.headers["last-event-id"]
        : undefined;
      const cursor = request.query.cursor ?? headerCursor ?? null;
      if (cursor !== null && !/^[0-9]+$/.test(cursor)) {
        return sendError(request, reply, 400, "INVALID_CURSOR", "Resume cursor is malformed");
      }
      const audiences = permittedAudiences(auth, request);
      const backlog = await repository.readOutbox(cursor, 100, audiences);
      const privacy = auth.privacyContext(request);
      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      reply.raw.write("retry: 5000\n\n");
      for (const event of backlog) {
        if (!writeEvent(reply, event, privacy)) {
          reply.raw.end();
          return reply;
        }
      }

      metrics.openStream();
      let closed = false;
      let unsubscribe: () => void = () => undefined;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        metrics.closeStream();
      };
      const heartbeat = setInterval(() => {
        if (!reply.raw.write(`: heartbeat ${Date.now()}\n\n`)) {
          reply.raw.end();
          close();
        }
      }, 15_000);
      heartbeat.unref();
      unsubscribe = repository.subscribeOutbox((event) => {
        if (!writeEvent(reply, event, privacy)) {
          reply.raw.end();
          close();
        }
      }, audiences);
      request.raw.once("close", close);
      request.raw.once("aborted", close);
      return reply;
    },
  );
}
