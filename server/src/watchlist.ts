import type { Db } from "./db.js";

// Watchlist rules and the check that turns them into alerts.
// A rule watches an item's min price: "below" fires at or under the threshold,
// "above" at or over it. Rules are edge-triggered: one alert when the price
// crosses, then nothing until it has gone back and crossed again
// (`triggered_at` remembers which side it is on). Sending is in notify.ts.

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

// The newest good snapshot, if any.
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

// True when the price is on the alerting side of the rule.
export function isPast(direction: Direction, threshold: number, price: number): boolean {
  return direction === "below" ? price <= threshold : price >= threshold;
}

// Each rule with its item's name and current min price.
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

// Adds a rule, or updates the threshold of the existing one (upsert). An updated
// rule is re-judged from scratch. Returns null for an item never seen.
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

  // Judge it now, so the page doesn't wait for the next snapshot.
  checkWatches({ db, houseId, now: () => now });

  return listWatches(db, houseId).find((w) => w.itemId === itemId && w.direction === direction) ?? null;
}

// Returns false if there was no such rule.
export function deleteWatch(db: Db, id: number): boolean {
  return db.prepare("DELETE FROM watches WHERE id = ?").run(id).changes > 0;
}

export interface CheckOptions {
  db: Db;
  houseId: number;
  now?: () => number;
}

// Compares every rule with the latest snapshot; returns how many alerts were
// raised. An unlisted item leaves its rule untouched. Safe to run twice.
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

  // A rule's state and its alert row are saved together or not at all.
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

// Newest first.
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
