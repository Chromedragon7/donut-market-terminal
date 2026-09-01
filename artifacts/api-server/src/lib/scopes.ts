import { eq } from "drizzle-orm";
import { db, itemVariants } from "@workspace/donut-data";
import {
  loadSalesForVariants,
  loadListingsForVariants,
  computeMetrics,
  type ItemMetrics,
  type SaleRow,
  type ListingRow,
} from "@workspace/donut-data";
import { baseScopeKey, variantScopeKey } from "@workspace/donut";

const THIRTY_DAYS = 30 * 86400 * 1000;

export interface ScopeSummary {
  scope: "base" | "variant";
  scopeKey: string;
  baseItemId: string;
  displayName: string;
  variantHash: string | null;
  metrics: ItemMetrics;
  sales: SaleRow[];
  listings: ListingRow[];
}

interface VariantRow {
  id: number;
  baseItemId: string;
  displayName: string;
  variantHash: string;
}

export async function buildScopeSummaries(
  scope: "base" | "variant",
): Promise<ScopeSummary[]> {
  const variants = (await db
    .select({
      id: itemVariants.id,
      baseItemId: itemVariants.baseItemId,
      displayName: itemVariants.displayName,
      variantHash: itemVariants.variantHash,
    })
    .from(itemVariants)) as VariantRow[];

  const since = Date.now() - THIRTY_DAYS;
  const summaries: ScopeSummary[] = [];

  if (scope === "base") {
    const groups = new Map<string, VariantRow[]>();
    for (const v of variants) {
      const arr = groups.get(v.baseItemId);
      if (arr) arr.push(v);
      else groups.set(v.baseItemId, [v]);
    }
    for (const [baseItemId, rows] of groups) {
      const ids = rows.map((r) => r.id);
      const sales = await loadSalesForVariants(ids, since);
      const listings = await loadListingsForVariants(ids);
      summaries.push({
        scope: "base",
        scopeKey: baseScopeKey(baseItemId),
        baseItemId,
        displayName: rows[0].displayName,
        variantHash: null,
        metrics: computeMetrics(sales, listings),
        sales,
        listings,
      });
    }
  } else {
    for (const v of variants) {
      const sales = await loadSalesForVariants([v.id], since);
      const listings = await loadListingsForVariants([v.id]);
      summaries.push({
        scope: "variant",
        scopeKey: variantScopeKey(v.variantHash),
        baseItemId: v.baseItemId,
        displayName: v.displayName,
        variantHash: v.variantHash,
        metrics: computeMetrics(sales, listings),
        sales,
        listings,
      });
    }
  }
  return summaries;
}

export async function variantsByBase(baseItemId: string): Promise<VariantRow[]> {
  return (await db
    .select({
      id: itemVariants.id,
      baseItemId: itemVariants.baseItemId,
      displayName: itemVariants.displayName,
      variantHash: itemVariants.variantHash,
    })
    .from(itemVariants)
    .where(eq(itemVariants.baseItemId, baseItemId))) as VariantRow[];
}
