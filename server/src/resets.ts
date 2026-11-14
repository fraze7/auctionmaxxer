import type { Db } from "./db.js";
import { median } from "./deals.js";

// Reset candidates: items where buying the cheapest listings leaves a much
// higher cheapest price, so the units bought can be relisted near it.
// For each item it tries buying the first 1, 2, 3... price levels and keeps
// the most profitable. The new price must stay within reach of what the item
// normally costs, or it is only a wall of overpriced listings.

const WEEK_SECONDS = 7 * 24 * 60 * 60;
// Hourly prices needed before "normal" means anything.
const MIN_HISTORY = 12;
// The price after the buyout may be at most this many times the normal price.
const MAX_OVER_NORMAL = 1.5;

export interface Reset {
  id: number;
  name: string | null;
  quality: string | null;
  units: number; // to buy
  cost: number; // to buy them
  floor: number; // cheapest price now
  newFloor: number; // cheapest price once they are bought
  normal: number; // 7-day median of the cheapest price
  remaining: number; // units still listed at or above the new price
  profit: number; // if every unit bought resells just under the new price
}

export interface Resets {
  takenAt: number | null;
  resets: Reset[];
}

interface Options {
  db: Db;
  houseId: number;
  ahCut: number;
  maxCost: number; // copper
  minRise: number; // new price / current price
  limit: number;
}

export function findResets({ db, houseId, ahCut, maxCost, minRise, limit }: Options): Resets {
  const snapshot = db
    .prepare<[number], { id: number; takenAt: number }>(`
      SELECT id, taken_at AS takenAt
      FROM snapshots
      WHERE house_id = ? AND kind = 'commodities' AND status = 'ok'
      ORDER BY taken_at DESC
      LIMIT 1
    `)
    .get(houseId);
  if (!snapshot) return { takenAt: null, resets: [] };

  const history = new Map<number, number[]>();
  const mins = db
    .prepare<[number, number], { itemId: number; minPrice: number }>(`
      SELECT p.item_id AS itemId, p.min_price AS minPrice
      FROM commodity_prices p
      JOIN snapshots s ON s.id = p.snapshot_id
      WHERE s.house_id = ? AND s.kind = 'commodities' AND s.status = 'ok' AND s.taken_at >= ?
    `)
    .all(houseId, snapshot.takenAt - WEEK_SECONDS);
  for (const { itemId, minPrice } of mins) {
    const list = history.get(itemId);
    if (list) list.push(minPrice);
    else history.set(itemId, [minPrice]);
  }

  const items = db
    .prepare<[number], { id: number; name: string | null; quality: string | null; quantity: number }>(`
      SELECT p.item_id AS id, i.name, i.quality, p.quantity
      FROM commodity_prices p
      LEFT JOIN items i ON i.item_id = p.item_id
      WHERE p.snapshot_id = ?
    `)
    .all(snapshot.id);
  const levelsOf = db.prepare<[number, number], { unitPrice: number; quantity: number }>(`
    SELECT unit_price AS unitPrice, quantity
    FROM price_levels
    WHERE snapshot_id = ? AND item_id = ?
    ORDER BY level
  `);

  const resets: Reset[] = [];
  for (const item of items) {
    const past = history.get(item.id) ?? [];
    if (past.length < MIN_HISTORY) continue;
    const normal = median(past);
    const levels = levelsOf.all(snapshot.id, item.id);
    const floor = levels[0]?.unitPrice;
    if (floor === undefined) continue;

    let best: Reset | undefined;
    let units = 0;
    let cost = 0;
    // Buy levels 0..k-1; level k becomes the cheapest.
    for (let k = 1; k < levels.length; k++) {
      units += levels[k - 1]!.quantity;
      cost += levels[k - 1]!.quantity * levels[k - 1]!.unitPrice;
      if (cost > maxCost) break;
      const newFloor = levels[k]!.unitPrice;
      if (newFloor < floor * minRise || newFloor > normal * MAX_OVER_NORMAL) continue;

      const profit = units * Math.floor((newFloor - 1) * (1 - ahCut)) - cost;
      if (profit > (best?.profit ?? 0)) {
        best = {
          id: item.id,
          name: item.name,
          quality: item.quality,
          units,
          cost,
          floor,
          newFloor,
          normal,
          remaining: item.quantity - units,
          profit,
        };
      }
    }
    if (best) resets.push(best);
  }

  resets.sort((a, b) => b.profit - a.profit);
  return { takenAt: snapshot.takenAt, resets: resets.slice(0, limit) };
}
