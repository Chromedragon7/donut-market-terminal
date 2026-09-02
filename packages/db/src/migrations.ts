import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool, PoolClient, QueryResultRow } from "pg";

const MIGRATION_LOCK_KEY = "donut-market-schema-migrations-v1";

export interface MigrationResult {
  readonly applied: readonly string[];
  readonly alreadyApplied: readonly string[];
}

interface AppliedMigrationRow extends QueryResultRow {
  readonly name: string;
  readonly checksum: string;
}

export function defaultMigrationsDirectory(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
}

export async function runMigrations(
  pool: Pool,
  migrationsDirectory = defaultMigrationsDirectory(),
): Promise<MigrationResult> {
  const client = await pool.connect();
  const applied: string[] = [];
  const alreadyApplied: string[] = [];
  let locked = false;
  let failed = false;

  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [MIGRATION_LOCK_KEY]);
    locked = true;
    await client.query(`
      CREATE TABLE IF NOT EXISTS donut_schema_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
        applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
      )
    `);

    const names = (await readdir(migrationsDirectory))
      .filter((name) => extname(name) === ".sql")
      .sort((left, right) => left.localeCompare(right));

    const existing = await client.query<AppliedMigrationRow>(
      "SELECT name, checksum FROM donut_schema_migrations ORDER BY name",
    );
    const checksumByName = new Map(existing.rows.map((row) => [row.name, row.checksum]));

    for (const name of names) {
      const sql = await readFile(join(migrationsDirectory, name), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const priorChecksum = checksumByName.get(name);

      if (priorChecksum !== undefined) {
        if (priorChecksum !== checksum) {
          throw new Error(`Applied migration ${name} has changed (checksum mismatch)`);
        }
        alreadyApplied.push(name);
        continue;
      }

      await applyMigration(client, name, checksum, sql);
      applied.push(name);
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      if (locked) {
        await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [MIGRATION_LOCK_KEY]);
      }
    } catch (unlockError) {
      if (!failed) throw unlockError;
    } finally {
      client.release();
    }
  }

  return { applied, alreadyApplied };
}

async function applyMigration(
  client: PoolClient,
  name: string,
  checksum: string,
  sql: string,
): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query(
      "INSERT INTO donut_schema_migrations (name, checksum) VALUES ($1, $2)",
      [name, checksum],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}
