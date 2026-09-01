import { Router, type IRouter } from "express";
import { and, desc, eq, gte, ilike, lte, sql, type SQL } from "drizzle-orm";
import {
  db,
  itemVariants,
  salesTransactions,
} from "@workspace/donut-data";
import { variantScopeKey } from "@workspace/donut";
import {
  GetDataSalesResponse,
  GetDataSalesQueryParams,
} from "@workspace/api-zod";
import { enchantsOf } from "../lib/serialize";

const router: IRouter = Router();

router.get("/data/sales", async (req, res) => {
  const params = GetDataSalesQueryParams.parse(req.query);

  const conditions: SQL[] = [];
  if (params.from) {
    const fromDate = new Date(params.from);
    if (!Number.isNaN(fromDate.getTime())) {
      conditions.push(gte(salesTransactions.soldAt, fromDate));
    }
  }
  if (params.to) {
    const toDate = new Date(params.to);
    if (!Number.isNaN(toDate.getTime())) {
      conditions.push(lte(salesTransactions.soldAt, toDate));
    }
  }
  if (params.item && params.item.trim() !== "") {
    conditions.push(ilike(itemVariants.displayName, `%${params.item.trim()}%`));
  }
  if (params.seller && params.seller.trim() !== "") {
    conditions.push(
      ilike(salesTransactions.sellerName, `%${params.seller.trim()}%`),
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(salesTransactions)
    .innerJoin(
      itemVariants,
      eq(salesTransactions.itemVariantId, itemVariants.id),
    )
    .where(where);

  const rows = await db
    .select({
      id: salesTransactions.id,
      variantHash: itemVariants.variantHash,
      baseItemId: itemVariants.baseItemId,
      displayName: itemVariants.displayName,
      sellerName: salesTransactions.sellerName,
      sellerUuid: salesTransactions.sellerUuid,
      quantity: salesTransactions.quantity,
      totalPrice: salesTransactions.totalPrice,
      unitPrice: salesTransactions.unitPrice,
      soldAt: salesTransactions.soldAt,
      enchantmentsJson: itemVariants.enchantmentsJson,
    })
    .from(salesTransactions)
    .innerJoin(
      itemVariants,
      eq(salesTransactions.itemVariantId, itemVariants.id),
    )
    .where(where)
    .orderBy(desc(salesTransactions.soldAt))
    .limit(params.pageSize)
    .offset((params.page - 1) * params.pageSize);

  const data = GetDataSalesResponse.parse({
    rows: rows.map((r) => ({
      id: r.id,
      scopeKey: variantScopeKey(r.variantHash),
      variantScopeKey: variantScopeKey(r.variantHash),
      baseItemId: r.baseItemId,
      displayName: r.displayName,
      sellerName: r.sellerName,
      sellerUuid: r.sellerUuid,
      quantity: r.quantity,
      totalPrice: Number(r.totalPrice),
      unitPrice: Number(r.unitPrice),
      soldAt: r.soldAt.toISOString(),
      enchants: enchantsOf(r.enchantmentsJson),
    })),
    total,
    page: params.page,
    pageSize: params.pageSize,
  });
  res.json(data);
});

export default router;
