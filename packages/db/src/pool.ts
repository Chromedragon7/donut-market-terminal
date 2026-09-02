import { Pool, types, type PoolConfig } from "pg";

// PostgreSQL NUMERIC and BIGINT must remain text at the JavaScript boundary.
types.setTypeParser(20, (value: string) => value);
types.setTypeParser(1700, (value: string) => value);

export interface DatabasePoolOptions {
  readonly connectionString: string;
  readonly applicationName?: string;
  readonly maxConnections?: number;
  readonly idleTimeoutMs?: number;
  readonly connectionTimeoutMs?: number;
  readonly ssl?: boolean | "require";
}

export function createDatabasePool(options: DatabasePoolOptions): Pool {
  const config: PoolConfig = {
    connectionString: options.connectionString,
    application_name: options.applicationName ?? "donut-market",
    max: options.maxConnections ?? 10,
    idleTimeoutMillis: options.idleTimeoutMs ?? 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 10_000,
    allowExitOnIdle: false,
  };

  if (options.ssl === true || options.ssl === "require") {
    config.ssl = { rejectUnauthorized: true };
  }

  return new Pool(config);
}
