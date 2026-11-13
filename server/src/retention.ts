import type { Db } from "./db.js";

// price_levels is by far the biggest table and only matters for recent
// snapshots, so old rows are deleted. commodity_prices keeps the long history.

export const DEFAULT_LEVELS_KEEP_DAYS = 14;
const DAY_SECONDS = 24 * 60 * 60;

export interface PruneOptions {
  db: Db;
  keepDays?: number;
  now?: () => number; // Unix seconds; only tests pass this
}

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
