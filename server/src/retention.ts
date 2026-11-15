import type { Db } from "./db.js";

// price_levels is by far the biggest table and only matters for recent
// snapshots, so old rows are deleted, and item_prices with it.
// commodity_prices keeps the long history.

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

  let removed = 0;
  for (const table of ["price_levels", "item_prices"]) {
    removed += options.db
      .prepare(`DELETE FROM ${table} WHERE snapshot_id IN (SELECT id FROM snapshots WHERE taken_at < ?)`)
      .run(cutoff).changes;
  }
  return removed;
}
