import type { Db } from "./db.js";

// Items listed on the auction house for less than a vendor pays for them:
// buy, walk to any vendor, sell. Counts every stored price level below the
// vendor price, so the profit is for buying all of those units.

export interface VendorDeal {
  id: number;
  name: string | null;
  quality: string | null;
  vendorPrice: number; // copper a vendor pays for one
  minPrice: number; // cheapest listing
  quantity: number; // units listed below the vendor price
  cost: number; // to buy them all
  profit: number; // after selling them all to a vendor
}

export interface VendorDeals {
  takenAt: number | null;
  priced: number; // items whose vendor price is known
  unpriced: number; // named items still waiting for a vendor price
  deals: VendorDeal[];
}

export function findVendorDeals(db: Db, houseId: number): VendorDeals {
  const counts = db
    .prepare<[], { priced: number; unpriced: number }>(`
      SELECT COALESCE(SUM(sell_price IS NOT NULL), 0) AS priced, COALESCE(SUM(sell_price IS NULL), 0) AS unpriced
      FROM items
      WHERE status = 'ok'
    `)
    .get()!;

  const snapshot = db
    .prepare<[number], { id: number; takenAt: number }>(`
      SELECT id, taken_at AS takenAt
      FROM snapshots
      WHERE house_id = ? AND kind = 'commodities' AND status = 'ok'
      ORDER BY taken_at DESC
      LIMIT 1
    `)
    .get(houseId);
  if (!snapshot) return { takenAt: null, ...counts, deals: [] };

  const deals = db
    .prepare<[number], VendorDeal>(`
      SELECT i.item_id AS id, i.name, i.quality, i.sell_price AS vendorPrice,
             MIN(l.unit_price) AS minPrice,
             SUM(l.quantity) AS quantity,
             SUM(l.quantity * l.unit_price) AS cost,
             SUM(l.quantity * (i.sell_price - l.unit_price)) AS profit
      FROM price_levels l
      JOIN items i ON i.item_id = l.item_id
      WHERE l.snapshot_id = ? AND i.sell_price > 0 AND l.unit_price < i.sell_price
      GROUP BY i.item_id
      ORDER BY profit DESC
    `)
    .all(snapshot.id);

  return { takenAt: snapshot.takenAt, ...counts, deals };
}
