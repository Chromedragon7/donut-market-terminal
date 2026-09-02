import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { ApiConfig } from "./config.js";
import type {
  MarketRepository,
  ModScope,
  StoredModToken,
  StoredSession,
  User,
} from "./contracts.js";
import { sendError } from "./errors.js";
import type { ApiMetrics } from "./metrics.js";
import type { PrivacyContext } from "./serializers.js";
import {
  constantTimeEqual,
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  verifyPassword,
} from "./security.js";

export const SESSION_COOKIE = "donut_session";
export const CSRF_COOKIE = "donut_csrf";

export interface AuthContext {
  user: User;
  kind: "session" | "mod_token";
  scopes: ModScope[];
  session: StoredSession | null;
  modToken: StoredModToken | null;
}

const loginBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["username", "password"],
  properties: {
    username: { type: "string", minLength: 1, maxLength: 80 },
    password: { type: "string", minLength: 1, maxLength: 1024 },
  },
} as const;

export class AuthService {
  private readonly contexts = new WeakMap<FastifyRequest, AuthContext>();
  private dummyPasswordHash = "";

  constructor(
    private readonly repository: MarketRepository,
    private readonly config: ApiConfig,
    private readonly metrics: ApiMetrics,
  ) {}

  async initialize(): Promise<void> {
    this.dummyPasswordHash = await hashPassword("not-a-real-account-password");
  }

  private reject(request: FastifyRequest, reply: FastifyReply, code = "AUTHENTICATION_REQUIRED"): FastifyReply {
    this.metrics.recordAuthenticationFailure();
    return sendError(request, reply, 401, code, "Authentication is required");
  }

  private async authenticateRequest(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const authorization = request.headers.authorization;
    if (authorization !== undefined) {
      const match = /^Bearer ([A-Za-z0-9_-]{20,256})$/.exec(authorization);
      if (match === null || match[1] === undefined) {
        this.reject(request, reply);
        return;
      }
      const tokenHash = hashOpaqueToken(match[1], this.config.tokenHashSecret);
      const token = await this.repository.findModTokenByHash(tokenHash);
      const now = Date.now();
      if (
        token === null ||
        token.revokedAt !== null ||
        (token.expiresAt !== null && Date.parse(token.expiresAt) <= now)
      ) {
        this.reject(request, reply);
        return;
      }
      const user = await this.repository.findUserById(token.userId);
      if (user === null) {
        this.reject(request, reply);
        return;
      }
      this.contexts.set(request, {
        user,
        kind: "mod_token",
        scopes: [...token.scopes],
        session: null,
        modToken: token,
      });
      return;
    }

    const rawSessionToken = request.cookies[SESSION_COOKIE];
    if (rawSessionToken === undefined || rawSessionToken.length < 20) {
      this.reject(request, reply);
      return;
    }
    const session = await this.repository.findSessionByTokenHash(
      hashOpaqueToken(rawSessionToken, this.config.tokenHashSecret),
    );
    const now = Date.now();
    if (session === null || session.revokedAt !== null || Date.parse(session.expiresAt) <= now) {
      if (session !== null && session.revokedAt === null) {
        await this.repository.revokeSession(session.id, new Date().toISOString());
      }
      this.reject(request, reply);
      return;
    }
    const user = await this.repository.findUserById(session.userId);
    if (user === null) {
      this.reject(request, reply);
      return;
    }
    this.contexts.set(request, {
      user,
      kind: "session",
      scopes: ["market:read", "stream:read"],
      session,
      modToken: null,
    });
  }

  requireAuth(scope?: ModScope, sessionOnly = false): preHandlerHookHandler {
    return async (request, reply) => {
      await this.authenticateRequest(request, reply);
      if (reply.sent) return;
      const context = this.contexts.get(request);
      if (context === undefined) {
        this.reject(request, reply);
        return;
      }
      if (sessionOnly && context.kind !== "session") {
        sendError(request, reply, 403, "SESSION_REQUIRED", "A browser session is required for this action");
        return;
      }
      if (scope !== undefined && !context.scopes.includes(scope)) {
        sendError(request, reply, 403, "INSUFFICIENT_SCOPE", `The ${scope} scope is required`);
      }
    };
  }

  requireOwner: preHandlerHookHandler = async (request, reply) => {
    if (reply.sent) return;
    const context = this.contexts.get(request);
    if (context === undefined || context.user.role !== "owner") {
      sendError(request, reply, 403, "OWNER_REQUIRED", "Owner access is required");
    }
  };

  requireAllowedOrigin: preHandlerHookHandler = async (request, reply) => {
    const origin = request.headers.origin?.replace(/\/$/, "");
    if (origin === undefined || !this.config.allowedOrigins.includes(origin)) {
      sendError(request, reply, 403, "ORIGIN_NOT_ALLOWED", "This request origin is not allowed");
    }
  };

  requireCsrf: preHandlerHookHandler = async (request, reply) => {
    if (reply.sent) return;
    const context = this.contexts.get(request);
    if (context === undefined || context.kind !== "session" || context.session === null) {
      sendError(request, reply, 403, "SESSION_REQUIRED", "A browser session is required for this action");
      return;
    }
    const headerValue = request.headers["x-csrf-token"];
    const headerToken = typeof headerValue === "string" ? headerValue : undefined;
    const cookieToken = request.cookies[CSRF_COOKIE];
    if (
      headerToken === undefined ||
      cookieToken === undefined ||
      !constantTimeEqual(headerToken, cookieToken) ||
      !constantTimeEqual(
        hashOpaqueToken(headerToken, this.config.tokenHashSecret),
        context.session.csrfHash,
      )
    ) {
      sendError(request, reply, 403, "CSRF_VALIDATION_FAILED", "CSRF validation failed");
    }
  };

  context(request: FastifyRequest): AuthContext {
    const context = this.contexts.get(request);
    if (context === undefined) throw new Error("Authenticated request context is missing");
    return context;
  }

  privacyContext(request: FastifyRequest): PrivacyContext {
    const context = this.context(request);
    return {
      role: context.user.role,
      policy: context.user.sellerPrivacy,
      pseudonymSecret: this.config.sellerPseudonymSecret,
    };
  }

  registerRoutes(app: FastifyInstance): void {
    app.post<{ Body: { username: string; password: string } }>(
      "/v1/auth/login",
      {
        schema: {
          tags: ["authentication"],
          summary: "Create a revocable owner or invited-user session",
          body: loginBodySchema,
        },
        config: { rateLimit: { max: this.config.loginRateLimitPerMinute, timeWindow: "1 minute" } },
        preHandler: this.requireAllowedOrigin,
      },
      async (request, reply) => {
        const stored = await this.repository.findUserByUsername(request.body.username);
        const valid = await verifyPassword(
          request.body.password,
          stored?.passwordHash ?? this.dummyPasswordHash,
        );
        if (stored === null || !valid) {
          this.metrics.recordAuthenticationFailure();
          return sendError(request, reply, 401, "INVALID_CREDENTIALS", "Username or password is incorrect");
        }
        const rawSessionToken = createOpaqueToken();
        const rawCsrfToken = createOpaqueToken();
        const createdAt = new Date();
        const expiresAt = new Date(createdAt.getTime() + this.config.sessionTtlMs);
        await this.repository.createSession({
          id: randomUUID(),
          userId: stored.user.id,
          tokenHash: hashOpaqueToken(rawSessionToken, this.config.tokenHashSecret),
          csrfHash: hashOpaqueToken(rawCsrfToken, this.config.tokenHashSecret),
          createdAt: createdAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
          revokedAt: null,
        });
        const sharedCookie = {
          path: "/",
          sameSite: "strict" as const,
          secure: this.config.cookieSecure,
          maxAge: Math.floor(this.config.sessionTtlMs / 1000),
        };
        reply.setCookie(SESSION_COOKIE, rawSessionToken, { ...sharedCookie, httpOnly: true });
        reply.setCookie(CSRF_COOKIE, rawCsrfToken, { ...sharedCookie, httpOnly: false });
        return reply.send({
          user: stored.user,
          expiresAt: expiresAt.toISOString(),
        });
      },
    );

    app.get(
      "/v1/auth/session",
      {
        schema: { tags: ["authentication"], summary: "Inspect the current session" },
        preHandler: this.requireAuth(undefined, true),
      },
      async (request) => {
        const context = this.context(request);
        return { user: context.user, expiresAt: context.session?.expiresAt ?? null };
      },
    );

    app.post(
      "/v1/auth/logout",
      {
        schema: { tags: ["authentication"], summary: "Revoke the current session" },
        preHandler: [this.requireAuth(undefined, true), this.requireAllowedOrigin, this.requireCsrf],
      },
      async (request, reply) => {
        const context = this.context(request);
        if (context.session !== null) {
          await this.repository.revokeSession(context.session.id, new Date().toISOString());
        }
        const clearOptions = {
          path: "/",
          sameSite: "strict" as const,
          secure: this.config.cookieSecure,
        };
        reply.clearCookie(SESSION_COOKIE, { ...clearOptions, httpOnly: true });
        reply.clearCookie(CSRF_COOKIE, { ...clearOptions, httpOnly: false });
        return reply.code(204).send();
      },
    );
  }
}
