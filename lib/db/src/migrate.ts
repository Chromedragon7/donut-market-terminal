import path from "path";
import { fileURLToPath } from "url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getPool } from "./index";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL must be set to run migrations. Did you forget to provision a database?",
    );
  }
  const pool = getPool();
  const db = drizzle(pool);
  const migrationsFolder = path.join(__dirname, "..", "migrations");
  await migrate(db, { migrationsFolder });
  await pool.end();
  console.log(`Migrations applied from ${migrationsFolder}`);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
