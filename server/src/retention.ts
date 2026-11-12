import type { Db } from "./db.js";

// Keeps the database from growing forever.
//
// price_levels (the order-book depth) is by far the biggest table: roughly
// 11,700 rows per hourly snapshot. It only matters for recent snapshots -
// "what does it cost to buy 300 right now?" - so rows older than two weeks
// are deleted. The long-term history lives in commodity_prices (one small row
// per item per snapshot), which this never touches.

export const DEFAULT_LEVELS_KEEP_DAYS = 14;
const DAY_SECONDS = 24 * 60 * 60;

export interface PruneOptions {
  db: Db;
  keepDays?: number;
  now?: () => number; // Unix seconds; only tests pass this
}

// Deletes price levels belonging to snapshots older than keepDays.
// Returns how many rows were removed.
export function pruneOldLevels(options: PruneOptions): number {
  const keepDays = options.keepDays ?? DEFAULT_LEVELS_KEEP_DAYS;
  const now = (options.now ?? (() => Math.floor(Date.now() / 1000)))();
  const cutoff = now - keepDays * DAY_SECONDS;

  const result = options.db
    .prepare(`
      DELETE FROM price_levels
      WHERE snapshot_id IN (SELECT id FROM snapshots WHERE taken_at < ?)
    `)
    .run(cutoff);
  return result.changes;
}
