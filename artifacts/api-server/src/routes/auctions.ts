import { Router, type IRouter } from "express";
import { and, desc, eq, gte, like, lte, sql, type SQL } from "drizzle-orm";
import {
  db,
  currentAuctionListings,
  itemVariants,
} from "@workspace/donut-data";
import { baseScopeKey, variantScopeKey } from "@workspace/donut";
import { GetAuctionsResponse, GetAuctionsQueryParams } from "@workspace/api-zod";
import { enchantsOf, trimOf, loreOf } from "../lib/serialize";

const router: IRouter = Router();

router.get("/auctions", async (req, res) => {
  const params = GetAuctionsQueryParams.parse(req.query);

  const conditions: SQL[] = [];
  if (params.search) {
    conditions.push(like(itemVariants.normalizedDisplayName, `%${params.search.toLowerCase()}%`));
  }
  if (params.seller) {
    conditions.push(eq(currentAuctionListings.sellerName, params.seller));
  }
  if (params.enchant) {
    conditions.push(
      sql`${itemVariants.enchantmentsJson}::text ILIKE ${`%${params.enchant}%`}`,
    );
  }
  if (params.trim) {
    conditions.push(
      sql`${itemVariants.trimJson}::text ILIKE ${`%${params.trim}%`}`,
    );
  }
  if (params.lore) {
    conditions.push(
      sql`${itemVariants.loreJson}::text ILIKE ${`%${params.lore}%`}`,
    );
  }
  if (params.minPrice !== undefined) {
    conditions.push(gte(currentAuctionListings.unitPrice, String(params.minPrice)));
  }
  if (params.maxPrice !== undefined) {
    conditions.push(lte(currentAuctionListings.unitPrice, String(params.maxPrice)));
  }
  if (params.minQuantity !== undefined) {
    conditions.push(gte(currentAuctionListings.quantity, params.minQuantity));
  }
  if (params.maxQuantity !== undefined) {
    conditions.push(lte(currentAuctionListings.quantity, params.maxQuantity));
  }
  if (params.maxTimeLeftMs !== undefined) {
    conditions.push(lte(currentAuctionListings.timeLeftMs, params.maxTimeLeftMs));
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const sortCol =
    params.sortBy === "quantity"
      ? currentAuctionListings.quantity
      : params.sortBy === "totalPrice"
        ? currentAuctionListings.totalPrice
        : currentAuctionListings.unitPrice;
  const orderBy = params.sortDir === "desc" ? desc(sortCol) : sortCol;

  const [{ c: total } = { c: 0 }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(currentAuctionListings)
    .innerJoin(
      itemVariants,
      eq(currentAuctionListings.itemVariantId, itemVariants.id),
    )
    .where(where ?? sql`true`);

  const rows = await db
    .select({
      id: currentAuctionListings.id,
      baseItemId: itemVariants.baseItemId,
      displayName: itemVariants.displayName,
      variantHash: itemVariants.variantHash,
      sellerName: currentAuctionListings.sellerName,
      sellerUuid: currentAuctionListings.sellerUuid,
      quantity: currentAuctionListings.quantity,
      totalPrice: currentAuctionListings.totalPrice,
      unitPrice: currentAuctionListings.unitPrice,
      timeLeftMs: currentAuctionListings.timeLeftMs,
      approxExpiresAt: currentAuctionListings.approxExpiresAt,
      enchantmentsJson: itemVariants.enchantmentsJson,
      trimJson: itemVariants.trimJson,
      loreJson: itemVariants.loreJson,
    })
    .from(currentAuctionListings)
    .innerJoin(
      itemVariants,
      eq(currentAuctionListings.itemVariantId, itemVariants.id),
    )
    .where(where ?? sql`true`)
    .orderBy(orderBy)
    .limit(params.pageSize)
    .offset((params.page - 1) * params.pageSize);

  const mapped = rows.map((r) => {
    const trim = trimOf(r.trimJson);
    return {
      id: r.id,
      scopeKey:
        params.scope === "variant"
          ? variantScopeKey(r.variantHash)
          : baseScopeKey(r.baseItemId),
      variantScopeKey: variantScopeKey(r.variantHash),
      baseItemId: r.baseItemId,
      displayName: r.displayName,
      sellerName: r.sellerName,
      sellerUuid: r.sellerUuid,
      quantity: r.quantity,
      totalPrice: Number(r.totalPrice),
      unitPrice: Number(r.unitPrice),
      timeLeftMs: r.timeLeftMs,
      approxExpiresAt: r.approxExpiresAt?.toISOString() ?? null,
      enchants: enchantsOf(r.enchantmentsJson),
      trimMaterial: trim.material,
      trimPattern: trim.pattern,
      lore: loreOf(r.loreJson),
    };
  });

  const data = GetAuctionsResponse.parse({
    rows: mapped,
    total,
    page: params.page,
    pageSize: params.pageSize,
    snapshotAt: null,
  });
  res.json(data);
});

export default router;
