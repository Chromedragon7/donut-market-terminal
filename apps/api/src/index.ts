import { randomUUID } from "node:crypto";
import { buildApp } from "./app.js";
import { loadConfigFromEnv } from "./config.js";
import { InMemoryMarketRepository } from "./memory-repository.js";
import { createPostgresMarketRepository, type PostgresMarketRepository } from "./postgres-repository.js";

const config = loadConfigFromEnv();

function positiveInteger(value: string | undefined, fallback: number, name: string, maximum: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be an integer from 1 through ${maximum}`);
  }
  return parsed;
}

const databaseUrl = process.env.DATABASE_URL;
let postgresRepository: PostgresMarketRepository | null = null;
const repository = databaseUrl !== undefined && databaseUrl.length > 0
  ? (postgresRepository = await createPostgresMarketRepository({
      connectionString: databaseUrl,
      ownerUsername: config.ownerUsername,
      ownerPasswordHash: config.ownerPasswordHash,
      ssl: process.env.DATABASE_SSL === "true" || process.env.DATABASE_SSL === "require" ? "require" : false,
      maxConnections: positiveInteger(process.env.DATABASE_MAX_CONNECTIONS, 10, "DATABASE_MAX_CONNECTIONS", 100),
      outboxPollMs: positiveInteger(process.env.OUTBOX_POLL_MS, 1000, "OUTBOX_POLL_MS", 60_000),
    }))
  : process.env.ALLOW_IN_MEMORY_REPOSITORY === "true" || config.nodeEnv === "test"
    ? new InMemoryMarketRepository({
        users: [
          {
            user: {
              id: randomUUID(),
              username: config.ownerUsername,
              role: "owner",
              sellerPrivacy: "full",
            },
            passwordHash: config.ownerPasswordHash,
          },
        ],
      })
    : (() => {
        throw new Error(
          "DATABASE_URL is required. Set ALLOW_IN_MEMORY_REPOSITORY=true only for an explicitly disposable preview.",
        );
      })();

const app = await buildApp({ repository, config });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "Graceful shutdown started");
  await app.close();
  await postgresRepository?.close();
  process.exitCode = 0;
};

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error({ err: error }, "API startup failed");
  process.exitCode = 1;
}
