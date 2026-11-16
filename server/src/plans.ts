import type { Db } from "./db.js";

// What the plan, pattern or formula for a recipe costs on the auction house.
// The item is found by name ("Plans: Radiant Boots"), so it is only known once
// it has been listed and its name looked up. Plans sold only by vendors or
// given by quests never appear.

const PREFIXES = ["Plans: ", "Pattern: ", "Formula: ", "Schematic: ", "Recipe: "];

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
