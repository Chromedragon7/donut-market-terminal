---
name: JSONB text filtering
description: Pragmatic substring search over jsonb columns in Drizzle/Postgres
---

To filter rows by free-text contained anywhere inside a `jsonb` column (e.g.
auction listings by enchantment id, trim material/pattern, or lore text), cast
the column to text and `ILIKE`:

```ts
sql`${itemVariants.enchantmentsJson}::text ILIKE ${`%${term}%`}`
```

**Why:** the JSON shapes here are small arrays/objects (enchants stored as
`[name, level]` pairs, trim as `{material, pattern}`, lore as string[]). A full
jsonb path/containment query would be more precise but heavier to write and not
worth it at this data scale.

**How to apply:** acceptable for low-cardinality, modest-volume tables. If these
filters ever need to scale, switch to proper jsonb operators (`@>`, `->>`) with
GIN indexes instead of text-cast ILIKE.
