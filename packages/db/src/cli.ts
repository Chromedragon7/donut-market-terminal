import { createDatabasePool } from "./pool.js";
import { runMigrations } from "./migrations.js";

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined || connectionString.length === 0) {
  throw new Error("DATABASE_URL is required");
}

const pool = createDatabasePool({ connectionString, applicationName: "donut-migrate", maxConnections: 1 });

try {
  const result = await runMigrations(pool);
  process.stdout.write(
    `${JSON.stringify({ event: "migrations_complete", ...result })}\n`,
  );
} finally {
  await pool.end();
}
