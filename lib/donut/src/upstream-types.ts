import { z } from "zod";

export const EnchantmentsSchema = z
  .object({
    levels: z.record(z.string(), z.number().nullish()).nullish(),
  })
  .passthrough();

export const TrimSchema = z
  .object({
    material: z.string().nullish(),
    pattern: z.string().nullish(),
  })
  .passthrough();

export const ItemDataSchema = z
  .object({
    enchantments: EnchantmentsSchema.nullish(),
    trim: TrimSchema.nullish(),
  })
  .passthrough();

export const ContainerItemSchema = z
  .object({
    id: z.string().nullish(),
    display_name: z.string().nullish(),
    count: z.number().nullish(),
    enchants: ItemDataSchema.nullish(),
  })
  .passthrough();

export const ItemSchema = z
  .object({
    id: z.string().nullish(),
    display_name: z.string().nullish(),
    count: z.number().nullish(),
    enchants: ItemDataSchema.nullish(),
    trim: TrimSchema.nullish(),
    lore: z.array(z.string()).nullish(),
    contents: z.array(ContainerItemSchema).nullish(),
  })
  .passthrough();

export const SellerSchema = z
  .object({
    name: z.string().nullish(),
    uuid: z.string().nullish(),
  })
  .passthrough();

export const AhSchema = z
  .object({
    item: ItemSchema.nullish(),
    price: z.number().nullish(),
    seller: SellerSchema.nullish(),
    time_left: z.number().nullish(),
  })
  .passthrough();

export const AhResponseSchema = z
  .object({
    result: z.array(AhSchema).nullish(),
    status: z.number().nullish(),
  })
  .passthrough();

export const PurchaseItemSchema = z
  .object({
    item: ItemSchema.nullish(),
    price: z.number().nullish(),
    seller: SellerSchema.nullish(),
    unixMillisDateSold: z.number().nullish(),
  })
  .passthrough();

export const TransactionHistoryResponseSchema = z
  .object({
    result: z.array(PurchaseItemSchema).nullish(),
    status: z.number().nullish(),
  })
  .passthrough();

export const LeaderboardEntrySchema = z
  .object({
    username: z.string().nullish(),
    uuid: z.string().nullish(),
    value: z.string().nullish(),
  })
  .passthrough();

export const LeaderboardResponseSchema = z
  .object({
    result: z.array(LeaderboardEntrySchema).nullish(),
    status: z.number().nullish(),
  })
  .passthrough();

export const LookupResponseSchema = z
  .object({
    result: z
      .object({
        location: z.string().nullish(),
        rank: z.string().nullish(),
        username: z.string().nullish(),
      })
      .passthrough()
      .nullish(),
    status: z.number().nullish(),
  })
  .passthrough();

export const StatsResponseSchema = z
  .object({
    result: z
      .object({
        broken_blocks: z.string().nullish(),
        deaths: z.string().nullish(),
        kills: z.string().nullish(),
        mobs_killed: z.string().nullish(),
        money: z.string().nullish(),
        money_made_from_sell: z.string().nullish(),
        money_spent_on_shop: z.string().nullish(),
        placed_blocks: z.string().nullish(),
        playtime: z.string().nullish(),
        shards: z.string().nullish(),
      })
      .passthrough()
      .nullish(),
    status: z.number().nullish(),
  })
  .passthrough();

export type Item = z.infer<typeof ItemSchema>;
export type Ah = z.infer<typeof AhSchema>;
export type PurchaseItem = z.infer<typeof PurchaseItemSchema>;
export type LeaderboardEntry = z.infer<typeof LeaderboardEntrySchema>;
export type LookupResponse = z.infer<typeof LookupResponseSchema>;
export type StatsResponse = z.infer<typeof StatsResponseSchema>;
