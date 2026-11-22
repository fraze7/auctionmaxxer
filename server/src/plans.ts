import type { Db } from "./db.js";

// What the plan, pattern or formula for a recipe costs on the auction house.
// The item is found by name ("Plans: Radiant Boots"), so it is only known once
// it has been listed and its name looked up. Plans sold only by vendors or
// given by quests never appear.

export const PREFIXES = ["Plans: ", "Pattern: ", "Formula: ", "Schematic: ", "Recipe: "];

// Dropped plans new to Forever that had never been listed by 16 Nov 2026, so
// their names could not be learned. Item IDs from Wowhead, by recipe name.
const PLAN_ITEMS: Record<string, number> = {
  "Blessed Plate Gauntlet": 251440,
  "Imperial Plate Gauntlets": 251441,
  "Blessed Plate Bracers": 251442,
  "Blessed Plate Leggings": 251443,
  "Blessed Plate Belt": 251444,
  "Blessed Plate Chest": 251446,
  "Tooled Leather Bracers": 252885,
  "Blue Suede Belt": 252886,
  "Blue Suede Bracers": 252888,
};

export interface PlanPrice {
  itemId: number;
  price: number | null; // cheapest buyout in the latest snapshot; null = none listed
  listed: number;
  seen: boolean; // listed at some point in the stored history (two weeks)
}

// Keyed by recipe name. Recipes whose plan item is not known are left out:
// those are sold by a vendor or come from a quest.
export function planPrices(db: Db, houseId: number, recipeNames: readonly string[]): Map<string, PlanPrice> {
  const latest = db
    .prepare<[number], { id: number }>(
      `
      SELECT id FROM snapshots
      WHERE house_id = ? AND kind = 'commodities' AND status = 'ok'
      ORDER BY taken_at DESC LIMIT 1
    `,
    )
    .get(houseId);
  const byName = db.prepare<{ name: string; snapshotId: number }, { itemId: number }>(`
    SELECT i.item_id AS itemId
    FROM items i
    LEFT JOIN item_prices p ON p.item_id = i.item_id AND p.snapshot_id = @snapshotId
    WHERE i.name = @name
    ORDER BY p.item_id IS NULL, i.item_id
    LIMIT 1
  `);
  const priceNow = db.prepare<
    { itemId: number; snapshotId: number },
    { price: number | null; listed: number | null; seen: number }
  >(`
    SELECT
      (SELECT min_buyout FROM item_prices WHERE item_id = @itemId AND snapshot_id = @snapshotId) AS price,
      (SELECT listing_count FROM item_prices WHERE item_id = @itemId AND snapshot_id = @snapshotId) AS listed,
      EXISTS (SELECT 1 FROM item_prices WHERE item_id = @itemId) AS seen
  `);
  const snapshotId = latest?.id ?? -1;

  const prices = new Map<string, PlanPrice>();
  for (const recipeName of recipeNames) {
    let itemId = PLAN_ITEMS[recipeName];
    for (const prefix of itemId === undefined ? PREFIXES : []) {
      itemId = byName.get({ name: prefix + recipeName, snapshotId })?.itemId;
      if (itemId !== undefined) break;
    }
    if (itemId === undefined) continue;
    const row = priceNow.get({ itemId, snapshotId })!;
    prices.set(recipeName, { itemId, price: row.price, listed: row.listed ?? 0, seen: row.seen === 1 });
  }
  return prices;
}

// "Recipe: Transmute Arcanite" and the spell "Transmute: Arcanite" should meet.
export function recipeKey(name: string): string {
  const prefix = PREFIXES.find((p) => name.startsWith(p));
  return (prefix ? name.slice(prefix.length) : name).replace(/:/g, "").toLowerCase();
}

// Every recipe item ever seen on the auction house, keyed by recipeKey of its
// name, with its price in the latest snapshot.
export function recipeItemPrices(db: Db, houseId: number): Map<string, PlanPrice> {
  const latest = db
    .prepare<[number], { id: number }>(
      `
      SELECT id FROM snapshots
      WHERE house_id = ? AND kind = 'commodities' AND status = 'ok'
      ORDER BY taken_at DESC LIMIT 1
    `,
    )
    .get(houseId);
  const like = PREFIXES.map((_, index) => `i.name LIKE @p${index}`).join(" OR ");
  const rows = db
    .prepare<Record<string, string | number>, { itemId: number; name: string; price: number | null; listed: number | null }>(
      `
      SELECT i.item_id AS itemId, i.name, now.min_buyout AS price, now.listing_count AS listed
      FROM items i
      LEFT JOIN item_prices now ON now.item_id = i.item_id AND now.snapshot_id = @snapshotId
      WHERE (${like}) AND EXISTS (SELECT 1 FROM item_prices p WHERE p.item_id = i.item_id)
    `,
    )
    .all({ snapshotId: latest?.id ?? -1, ...Object.fromEntries(PREFIXES.map((p, index) => [`p${index}`, `${p}%`])) });
  const prices = new Map<string, PlanPrice>();
  for (const row of rows) {
    const key = recipeKey(row.name);
    const known = prices.get(key);
    // Two items of one name: keep the one on sale, then the cheaper.
    if (known && known.price !== null && (row.price === null || row.price >= known.price)) continue;
    prices.set(key, { itemId: row.itemId, price: row.price, listed: row.listed ?? 0, seen: true });
  }
  return prices;
}
