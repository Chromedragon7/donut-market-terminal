---
name: Item display names from DonutSMP API
description: DonutSMP sends empty-string display_name for default Minecraft items; must fall back to base_item_id.
---

The DonutSMP API omits or sends `""` for `display_name` on standard Minecraft items (e.g. `minecraft:netherite_pickaxe`) that don't have a custom in-game name. Only items with custom enchantment names, renamed items, or items with lore have a non-empty `display_name`.

**Why:** `item.display_name ?? canonical.baseItemId` uses `??` which only falls back for `null`/`undefined`, not empty string `""`. All items end up with `displayName: ""` in `item_variants`.

**How to apply:**
- `normalizeItem()` in `variant.ts` uses `item.display_name || canonical.baseItemId` (logical OR, falls back on falsy including `""`).
- On a fresh collection the upsertVariant `onConflictDoUpdate` updates `displayName` for existing rows, so re-running the collectors heals the backlog.
- If items already exist with empty display_name, run: `UPDATE item_variants SET display_name = base_item_id WHERE display_name = '' OR display_name IS NULL;`
