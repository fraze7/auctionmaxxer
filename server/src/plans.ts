import type { Db } from "./db.js";

// What the plan, pattern or formula for a recipe costs on the auction house.
// The item is found by name ("Plans: Radiant Boots"), so it is only known once
// it has been listed and its name looked up. Plans sold only by vendors or
// given by quests never appear.

const PREFIXES = ["Plans: ", "Pattern: ", "Formula: ", "Schematic: ", "Recipe: "];

export interface PlanPrice {
  itemId: number;
  price: number | null; // cheapest buyout in the latest snapshot; null = none listed
  listed: number;
}

// Keyed by recipe name; recipes whose plan item has never been seen are left out.
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
  const find = db.prepare<
    { name: string; snapshotId: number },
    { itemId: number; price: number | null; listed: number | null }
  >(`
    SELECT i.item_id AS itemId, p.min_buyout AS price, p.listing_count AS listed
    FROM items i
    LEFT JOIN item_prices p ON p.item_id = i.item_id AND p.snapshot_id = @snapshotId
    WHERE i.name = @name
    ORDER BY p.item_id IS NULL, i.item_id
    LIMIT 1
  `);

  const prices = new Map<string, PlanPrice>();
  for (const recipeName of recipeNames) {
    for (const prefix of PREFIXES) {
      const row = find.get({ name: prefix + recipeName, snapshotId: latest?.id ?? -1 });
      if (!row) continue;
      prices.set(recipeName, { itemId: row.itemId, price: row.price, listed: row.listed ?? 0 });
      break;
    }
  }
  return prices;
}
