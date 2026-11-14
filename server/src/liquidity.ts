import type { Db } from "./db.js";

// Estimates how many units of each item sell per day. Blizzard does not report
// sales, so this counts units that vanish from the cheap end of the order book
// between one snapshot and the next: everything that was listed below the next
// snapshot's cheapest price, plus the shortfall at that price. Those were
// almost certainly bought. It misses anything listed and sold within the hour,
// counts a cancelled cheap listing as a sale, and a buyout as demand.

const DAY_SECONDS = 24 * 60 * 60;
const WINDOW_DAYS = 3;
// Less history than this and a rate per day is a guess.
const MIN_COVERED_DAYS = 0.5;

export interface Liquidity {
  coveredDays: number; // how much history the estimate is based on
  soldPerDay: ReadonlyMap<number, number>; // empty when there is too little history
}

export function estimateSales(db: Db, houseId: number): Liquidity {
  const span = db
    .prepare<{ house: number }, { first: number | null; last: number | null }>(`
      SELECT MIN(taken_at) AS first, MAX(taken_at) AS last
      FROM snapshots
      WHERE house_id = @house AND kind = 'commodities' AND status = 'ok'
        AND taken_at >= (
          SELECT MAX(taken_at) FROM snapshots WHERE house_id = @house AND kind = 'commodities' AND status = 'ok'
        ) - ${WINDOW_DAYS * DAY_SECONDS}
    `)
    .get({ house: houseId });
  const first = span?.first ?? null;
  const last = span?.last ?? null;
  const coveredDays = first === null || last === null ? 0 : (last - first) / DAY_SECONDS;
  if (first === null || coveredDays < MIN_COVERED_DAYS) return { coveredDays, soldPerDay: new Map() };

  const rows = db
    .prepare<[number, number], { itemId: number; sold: number }>(`
      WITH s AS (
        SELECT id, LEAD(id) OVER (ORDER BY taken_at) AS next_id
        FROM snapshots
        WHERE house_id = ? AND kind = 'commodities' AND status = 'ok' AND taken_at >= ?
      )
      SELECT a.item_id AS itemId,
             SUM(CASE
               WHEN b.min_price IS NULL OR a.unit_price < b.min_price THEN a.quantity
               WHEN a.unit_price = b.min_price THEN MAX(0, a.quantity - b.qty_at_min)
               ELSE 0
             END) AS sold
      FROM s
      JOIN price_levels a ON a.snapshot_id = s.id
      LEFT JOIN commodity_prices b ON b.snapshot_id = s.next_id AND b.item_id = a.item_id
      WHERE s.next_id IS NOT NULL
      GROUP BY a.item_id
    `)
    .all(houseId, first);

  const soldPerDay = new Map(rows.map((row) => [row.itemId, Math.round((row.sold / coveredDays) * 10) / 10]));
  return { coveredDays, soldPerDay };
}
