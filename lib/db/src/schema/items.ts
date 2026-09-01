import {
  index,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const itemVariants = pgTable(
  "item_variants",
  {
    id: serial("id").primaryKey(),
    baseItemId: text("base_item_id").notNull(),
    displayName: text("display_name").notNull(),
    normalizedDisplayName: text("normalized_display_name").notNull(),
    variantHash: text("variant_hash").notNull(),
    enchantmentsJson: jsonb("enchantments_json"),
    trimJson: jsonb("trim_json"),
    loreJson: jsonb("lore_json"),
    contentsJson: jsonb("contents_json"),
    canonicalJson: jsonb("canonical_json").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("item_variants_variant_hash_uq").on(t.variantHash),
    index("item_variants_base_item_idx").on(t.baseItemId),
    index("item_variants_display_name_idx").on(t.normalizedDisplayName),
  ],
);

export type ItemVariant = typeof itemVariants.$inferSelect;
export type InsertItemVariant = typeof itemVariants.$inferInsert;
