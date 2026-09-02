import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import Fastify, { type FastifyInstance } from "fastify";
import { AuthService } from "./auth.js";
import type { ApiConfig } from "./config.js";
import { RepositoryError, type MarketRepository } from "./contracts.js";
import { errorEnvelope, sendError } from "./errors.js";
import { ApiMetrics } from "./metrics.js";
import { registerLiveRoutes } from "./routes/live.js";
import { registerMarketRoutes } from "./routes/market.js";
import { registerUserRoutes } from "./routes/user.js";
import { constantTimeEqual } from "./security.js";

export interface BuildAppOptions {
  repository: MarketRepository;
  config: ApiConfig;
  logger?: boolean;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: true,
    bodyLimit: options.config.requestBodyLimitBytes,
    ajv: {
      customOptions: {
        removeAdditional: false,
      },
    },
    logger: options.logger === false
      ? false
      : {
          level: process.env.LOG_LEVEL ?? "info",
          redact: {
            paths: [
              "req.headers.authorization",
              "req.headers.cookie",
              "req.headers.x-csrf-token",
              "res.headers.set-cookie",
              "body.password",
              "body.token",
              "password",
              "token",
              "upstreamApiKey",
            ],
            censor: "[REDACTED]",
          },
        },
  });
  const metrics = new ApiMetrics();

  await app.register(cookie);
  await app.register(cors, {
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["content-type", "authorization", "x-csrf-token", "last-event-id"],
    origin: (origin, callback) => {
      if (origin === undefined) {
        callback(null, false);
        return;
      }
      callback(null, options.config.allowedOrigins.includes(origin.replace(/\/$/, "")));
    },
  });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: "same-site" },
    referrerPolicy: { policy: "no-referrer" },
  });
  await app.register(rateLimit, {
    global: true,
    max: options.config.globalRateLimitPerMinute,
    timeWindow: "1 minute",
    errorResponseBuilder: (request) => errorEnvelope(
      request,
      "RATE_LIMITED",
      "Too many requests; retry after the advertised interval",
    ),
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Donut Market Intelligence API",
        version: "0.1.0",
        description: "Authenticated, source-aware market reads. Active asks and completed sales are never interchangeable.",
      },
      components: {
        securitySchemes: {
          sessionCookie: { type: "apiKey", in: "cookie", name: "donut_session" },
          modBearer: { type: "http", scheme: "bearer", bearerFormat: "opaque revocable token" },
        },
      },
      tags: [
        { name: "authentication" },
        { name: "market" },
        { name: "personal" },
        { name: "live" },
        { name: "operations" },
        { name: "future" },
      ],
    },
  });

  app.addHook("onResponse", async (_request, reply) => {
    metrics.recordResponse(reply.statusCode);
  });

  app.get(
    "/health/live",
    { schema: { hide: true }, config: { rateLimit: false } },
    async () => ({ status: "ok", timestamp: new Date().toISOString() }),
  );

  app.get(
    "/health/ready",
    { schema: { hide: true }, config: { rateLimit: false } },
    async (_request, reply) => {
      const readiness = await options.repository.readiness();
      return reply.code(readiness.ready ? 200 : 503).send({
        status: readiness.ready ? "ready" : "not_ready",
        checks: readiness.checks,
        timestamp: new Date().toISOString(),
      });
    },
  );

  app.get(
    "/metrics",
    { schema: { hide: true }, config: { rateLimit: false } },
    async (request, reply) => {
      const configured = options.config.metricsBearerToken;
      const supplied = request.headers.authorization;
      if (
        configured !== null &&
        (supplied === undefined || !constantTimeEqual(supplied, `Bearer ${configured}`))
      ) {
        return sendError(request, reply, 401, "METRICS_AUTHENTICATION_REQUIRED", "Metrics authentication is required");
      }
      reply.type("text/plain; version=0.0.4; charset=utf-8");
      return metrics.toPrometheus();
    },
  );

  const auth = new AuthService(options.repository, options.config, metrics);
  await auth.initialize();
  auth.registerRoutes(app);
  registerMarketRoutes(app, options.repository, auth);
  registerUserRoutes(app, options.repository, auth, options.config);
  registerLiveRoutes(app, options.repository, auth, metrics, options.config);

  if (options.config.exposeOpenApi) {
    app.get(
      "/openapi.json",
      { schema: { hide: true }, config: { rateLimit: false } },
      async (_request, reply) => reply.send(app.swagger()),
    );
  }

  app.setNotFoundHandler((request, reply) =>
    sendError(request, reply, 404, "ROUTE_NOT_FOUND", "Route was not found"),
  );

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof RepositoryError) {
      const status = error.code === "INVALID_CURSOR" ? 400 : error.code === "CONFLICT" ? 409 : 503;
      return sendError(request, reply, status, error.code, error.message);
    }
    const fastifyError = error as {
      validation?: Array<{ instancePath?: string; message?: string }>;
      statusCode?: number;
    };
    if (fastifyError.validation !== undefined) {
      return sendError(
        request,
        reply,
        400,
        "INVALID_REQUEST",
        "Request validation failed",
        fastifyError.validation.map((issue) => ({ path: issue.instancePath ?? "", message: issue.message ?? "invalid value" })),
      );
    }
    if (fastifyError.statusCode === 413) {
      return sendError(request, reply, 413, "PAYLOAD_TOO_LARGE", "Request payload is too large");
    }
    if (fastifyError.statusCode === 429) {
      return sendError(request, reply, 429, "RATE_LIMITED", "Too many requests");
    }
    request.log.error({ err: error }, "Unhandled API request failure");
    return sendError(request, reply, 500, "INTERNAL_ERROR", "An internal error occurred");
  });

  return app;
}
