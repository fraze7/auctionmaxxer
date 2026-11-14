import type { Db } from "./db.js";

// Items whose price moved most between an earlier snapshot and the latest one.
// Ranked by the change in median price, and only counted when the cheapest
// listing moved the same way. Thinly listed items are left out as noise.

// Fewer separate listings than this, then or now, and one seller sets the price.
const MIN_LISTINGS = 5;
// The cheapest listing must have moved the same way by at least this factor;
// otherwise it is a few silly listings dragging the median, not a real move.
const MIN_SHIFT = 1.1;

export interface Mover {
  id: number;
  name: string | null;
  quality: string | null;
  before: number; // median then
  now: number; // median now
  minPrice: number; // cheapest listing now
  quantity: number; // units on sale now
  change: number; // now / before
}

export interface Movers {
  takenAt: number | null;
  comparedTo: number | null; // when the earlier snapshot was taken
  risers: Mover[];
  fallers: Mover[];
}

interface Options {
  db: Db;
  houseId: number;
  hours: number;
  minQuantity: number;
  minPrice: number; // copper; the higher of the two medians must reach this
  limit: number;
}

export function findMovers({ db, houseId, hours, minQuantity, minPrice, limit }: Options): Movers {
  const snapshotAt = (where: string, order: string) =>
    db.prepare<[number, number], { id: number; takenAt: number }>(`
      SELECT id, taken_at AS takenAt
      FROM snapshots
      WHERE house_id = ? AND kind = 'commodities' AND status = 'ok' AND ${where}
      ORDER BY taken_at ${order}
      LIMIT 1
    `);

  const latest = snapshotAt("taken_at > ?", "DESC").get(houseId, 0);
  if (!latest) return { takenAt: null, comparedTo: null, risers: [], fallers: [] };

  // The newest snapshot at least `hours` old, or the oldest there is.
  const target = latest.takenAt - hours * 3600;
  const earlier =
    snapshotAt("taken_at <= ?", "DESC").get(houseId, target) ?? snapshotAt("taken_at > ?", "ASC").get(houseId, 0);
  if (!earlier || earlier.id === latest.id) {
    return { takenAt: latest.takenAt, comparedTo: null, risers: [], fallers: [] };
  }

  const movers = db
    .prepare<[number, number, number, number], Mover>(`
      SELECT n.item_id AS id, i.name, i.quality,
             b.median_price AS before, n.median_price AS now,
             n.min_price AS minPrice, n.quantity,
             CAST(n.median_price AS REAL) / b.median_price AS change
      FROM commodity_prices n
      JOIN commodity_prices b ON b.item_id = n.item_id AND b.snapshot_id = ?
      LEFT JOIN items i ON i.item_id = n.item_id
      WHERE n.snapshot_id = ? AND n.quantity >= ? AND b.quantity >= n.quantity / 10
        AND MAX(n.median_price, b.median_price) >= ?
        AND n.listing_count >= ${MIN_LISTINGS} AND b.listing_count >= ${MIN_LISTINGS}
        AND (
          (n.median_price > b.median_price AND n.min_price >= b.min_price * ${MIN_SHIFT})
          OR (n.median_price < b.median_price AND n.min_price * ${MIN_SHIFT} <= b.min_price)
        )
      ORDER BY change DESC
    `)
    .all(earlier.id, latest.id, minQuantity, minPrice);

  return {
    takenAt: latest.takenAt,
    comparedTo: earlier.takenAt,
    risers: movers.filter((m) => m.change > 1).slice(0, limit),
    fallers: movers
      .filter((m) => m.change < 1)
      .reverse()
      .slice(0, limit),
  };
}
