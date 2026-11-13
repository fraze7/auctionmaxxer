import type { Db } from "./db.js";

// The watchlist: price rules, and the check that turns them into alerts.
//
// A rule watches one item's CHEAPEST price (the min price):
//   below 4000  -> fires when the min price is 40s or less  (time to buy)
//   above 9000  -> fires when the min price is 90s or more  (time to sell)
//
// The important idea is "edge triggering". A rule doesn't alert every hour
// the price sits past the threshold - that would be 24 messages a day about
// the same thing. It alerts once, at the moment the price CROSSES it, then
// stays quiet until the price has gone back and crossed again. The
// `triggered_at` column is the memory that makes this possible.
//
// This file only writes rows. Telling Discord about them is notify.ts.

export type Direction = "below" | "above";

export interface Watch {
  id: number;
  itemId: number;
  name: string | null;
  quality: string | null;
  direction: Direction;
  threshold: number; // copper per unit
  createdAt: number;
  triggeredAt: number | null; // null = not triggered right now
  currentMin: number | null; // null = not listed in the latest snapshot
}

export interface Alert {
  id: number;
  itemId: number;
  name: string | null;
  quality: string | null;
  direction: Direction;
  threshold: number;
  price: number;
  takenAt: number;
  notifiedAt: number | null;
}

const unixNow = () => Math.floor(Date.now() / 1000);

// The newest good snapshot for a house, or undefined if there isn't one.
function latestSnapshot(db: Db, houseId: number): { id: number; takenAt: number } | undefined {
  return db
    .prepare<[number], { id: number; takenAt: number }>(`
      SELECT id, taken_at AS takenAt
      FROM snapshots
      WHERE house_id = ? AND kind = 'commodities' AND status = 'ok'
      ORDER BY taken_at DESC
      LIMIT 1
    `)
    .get(houseId);
}

// True when a price is on the "tell me" side of a rule.
export function isPast(direction: Direction, threshold: number, price: number): boolean {
  return direction === "below" ? price <= threshold : price >= threshold;
}

// Every rule for a house, each with the item's name and current min price.
export function listWatches(db: Db, houseId: number): Watch[] {
  const snapshot = latestSnapshot(db, houseId);
  return db
    .prepare<{ houseId: number; snapshotId: number }, Watch>(`
      SELECT w.id, w.item_id AS itemId, i.name, i.quality, w.direction, w.threshold,
             w.created_at AS createdAt, w.triggered_at AS triggeredAt, p.min_price AS currentMin
      FROM watches w
      JOIN items i ON i.item_id = w.item_id
      LEFT JOIN commodity_prices p ON p.item_id = w.item_id AND p.snapshot_id = @snapshotId
      WHERE w.house_id = @houseId
      ORDER BY i.name IS NULL, i.name COLLATE NOCASE, w.item_id, w.direction DESC
    `)
    .all({ houseId, snapshotId: snapshot?.id ?? -1 });
}

export interface SaveWatchOptions {
  db: Db;
  houseId: number;
  itemId: number;
  direction: Direction;
  threshold: number;
  now?: () => number;
}

// Adds a rule, or - if the item already has one in that direction - changes
// its threshold. Returns null when the item has never been seen.
//
// "INSERT ... ON CONFLICT DO UPDATE" is SQLite's upsert: try to insert, and if
// that would break the UNIQUE (house, item, direction) rule, update the
// existing row instead. A changed rule forgets its triggered state, so it is
// judged afresh against the new threshold.
export function saveWatch(options: SaveWatchOptions): Watch | null {
  const { db, houseId, itemId, direction, threshold } = options;
  const now = (options.now ?? unixNow)();

  const known = db.prepare<[number], { n: number }>("SELECT COUNT(*) AS n FROM items WHERE item_id = ?").get(itemId);
  if (!known?.n) return null;

  db.prepare(`
    INSERT INTO watches (house_id, item_id, direction, threshold, created_at)
    VALUES (@houseId, @itemId, @direction, @threshold, @now)
    ON CONFLICT (house_id, item_id, direction)
    DO UPDATE SET threshold = excluded.threshold, triggered_at = NULL
  `).run({ houseId, itemId, direction, threshold, now });

  // Judge it against the latest snapshot straight away, so the page shows
  // whether it's already past the threshold without waiting for the next hour.
  checkWatches({ db, houseId, now: () => now });

  return listWatches(db, houseId).find((w) => w.itemId === itemId && w.direction === direction) ?? null;
}

// Removes a rule. Returns false if there was no rule with that ID.
export function deleteWatch(db: Db, id: number): boolean {
  return db.prepare("DELETE FROM watches WHERE id = ?").run(id).changes > 0;
}

export interface CheckOptions {
  db: Db;
  houseId: number;
  now?: () => number;
}

// Compares every rule with the latest snapshot. Run after each new snapshot.
// Returns how many new alerts were raised.
//
// For each rule there are three cases:
//   * the item isn't listed at all -> no price to judge, leave the rule alone
//   * the price is past the threshold -> if it wasn't before, raise an alert
//   * the price is back on the quiet side -> reset, ready to fire again
//
// Running it twice on the same snapshot is harmless: the second run finds
// every rule already in the right state and raises nothing.
export function checkWatches(options: CheckOptions): number {
  const { db, houseId } = options;
  const now = (options.now ?? unixNow)();
  const snapshot = latestSnapshot(db, houseId);
  if (!snapshot) return 0;

  const setTriggered = db.prepare<[number | null, number]>("UPDATE watches SET triggered_at = ? WHERE id = ?");
  const addAlert = db.prepare(`
    INSERT INTO alerts (house_id, item_id, direction, threshold, price, taken_at, created_at)
    VALUES (@houseId, @itemId, @direction, @threshold, @price, @takenAt, @now)
  `);

  // One transaction: a rule's state and its alert row are saved together or
  // not at all, so a crash can't leave a rule "triggered" with no alert.
  const run = db.transaction(() => {
    let raised = 0;
    for (const watch of listWatches(db, houseId)) {
      if (watch.currentMin === null) continue;

      const past = isPast(watch.direction, watch.threshold, watch.currentMin);
      if (past && watch.triggeredAt === null) {
        setTriggered.run(snapshot.takenAt, watch.id);
        addAlert.run({
          houseId,
          itemId: watch.itemId,
          direction: watch.direction,
          threshold: watch.threshold,
          price: watch.currentMin,
          takenAt: snapshot.takenAt,
          now,
        });
        raised++;
      } else if (!past && watch.triggeredAt !== null) {
        setTriggered.run(null, watch.id);
      }
    }
    return raised;
  });
  return run.immediate();
}

// The most recent alerts for a house, newest first.
export function listAlerts(db: Db, houseId: number, limit = 50): Alert[] {
  return db
    .prepare<[number, number], Alert>(`
      SELECT a.id, a.item_id AS itemId, i.name, i.quality, a.direction, a.threshold, a.price,
             a.taken_at AS takenAt, a.notified_at AS notifiedAt
      FROM alerts a
      LEFT JOIN items i ON i.item_id = a.item_id
      WHERE a.house_id = ?
      ORDER BY a.taken_at DESC, a.id DESC
      LIMIT ?
    `)
    .all(houseId, limit);
}
