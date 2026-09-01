import {
  itemVariants,
  salesTransactions,
  type InsertSalesTransaction,
} from "@workspace/db";
import { type NormalizedItem } from "@workspace/donut";
import { db } from "./db";

type DbLike = typeof db;

export async function upsertVariant(
  normalized: NormalizedItem,
  tx: DbLike = db,
): Promise<number> {
  const rows = await tx
    .insert(itemVariants)
    .values({
      baseItemId: normalized.baseItemId,
      displayName: normalized.displayName,
      normalizedDisplayName: normalized.normalizedDisplayName,
      variantHash: normalized.variantHash,
      enchantmentsJson: normalized.canonical.enchantments,
      trimJson: normalized.canonical.trim,
      loreJson: normalized.canonical.lore,
      contentsJson: normalized.canonical.contents,
      canonicalJson: JSON.parse(normalized.canonicalJson),
    })
    .onConflictDoUpdate({
      target: itemVariants.variantHash,
      set: {
        displayName: normalized.displayName,
        updatedAt: new Date(),
      },
    })
    .returning({ id: itemVariants.id });
  return rows[0].id;
}

export async function insertTransactionsIgnoreConflicts(
  values: InsertSalesTransaction[],
  tx: DbLike = db,
): Promise<number> {
  if (values.length === 0) return 0;
  const inserted = await tx
    .insert(salesTransactions)
    .values(values)
    .onConflictDoNothing({ target: salesTransactions.dedupeHash })
    .returning({ id: salesTransactions.id });
  return inserted.length;
}

export async function distinctBaseItemIds(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ baseItemId: itemVariants.baseItemId })
    .from(itemVariants);
  return rows.map((r) => r.baseItemId);
}

export function nextSnapshotId(): number {
  return Math.floor(Date.now() / 1000);
}
