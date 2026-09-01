import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export { db, pool } from "@workspace/db";

function lockKey(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return hash;
}

export async function tryAdvisoryLock(name: string): Promise<boolean> {
  const key = lockKey(name);
  const rows = await db.execute<{ locked: boolean }>(
    sql`select pg_try_advisory_lock(${key}) as locked`,
  );
  const row = rows.rows[0] as { locked: boolean } | undefined;
  return row?.locked === true;
}

export async function releaseAdvisoryLock(name: string): Promise<void> {
  const key = lockKey(name);
  await db.execute(sql`select pg_advisory_unlock(${key})`);
}

export async function withAdvisoryLock<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  const acquired = await tryAdvisoryLock(name);
  if (!acquired) return null;
  try {
    return await fn();
  } finally {
    await releaseAdvisoryLock(name);
  }
}
