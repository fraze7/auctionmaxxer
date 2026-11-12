import type { DataSource } from "./dataSource.js";
import type { Db } from "./db.js";

// The item-name backfill queue.
//
// The collector only knows item IDs. Each new ID gets a 'pending' row in
// `items`; this job works through those rows a batch at a time, asking the
// source for each name. Doing it in small batches spread over many runs
// keeps us far below Blizzard's rate limits (100 requests a second).
//
// An item ends up in one of two states:
//   'ok'      - name (and quality) stored
//   'missing' - Blizzard has no data for it. Tried again after a week, since
//               Blizzard fills its item data in over time.

export const DEFAULT_BATCH_SIZE = 100;
const RETRY_MISSING_AFTER_SECONDS = 7 * 24 * 60 * 60;

export interface BackfillOptions {
  db: Db;
  source: DataSource;
  // Most items to look up in this run.
  limit?: number;
  // Current time in Unix seconds. Only tests pass this.
  now?: () => number;
}

export interface BackfillResult {
  found: number; // now 'ok'
  missing: number; // now 'missing'
  remaining: number; // still waiting for a later run
  // Set when a lookup failed (network down, Blizzard erroring). The batch
  // stops there; the item stays queued and is tried again next run.
  error?: string;
}

export async function backfillItems(options: BackfillOptions): Promise<BackfillResult> {
  const { db, source } = options;
  const limit = options.limit ?? DEFAULT_BATCH_SIZE;
  const now = (options.now ?? (() => Math.floor(Date.now() / 1000)))();
  const retryMissingBefore = now - RETRY_MISSING_AFTER_SECONDS;

  // Never-tried items first (oldest sighting first), then stale 'missing' ones.
  const DUE = `
    status = 'pending' OR (status = 'missing' AND fetched_at <= @retryMissingBefore)
  `;
  const batch = db
    .prepare<{ retryMissingBefore: number; limit: number }, { itemId: number }>(`
      SELECT item_id AS itemId FROM items
      WHERE ${DUE}
      ORDER BY status = 'pending' DESC, first_seen, item_id
      LIMIT @limit
    `)
    .all({ retryMissingBefore, limit });

  const markOk = db.prepare(
    "UPDATE items SET status = 'ok', name = ?, quality = ?, fetched_at = ? WHERE item_id = ?",
  );
  const markMissing = db.prepare(
    "UPDATE items SET status = 'missing', fetched_at = ? WHERE item_id = ?",
  );

  let found = 0;
  let missing = 0;
  let error: string | undefined;

  // One at a time, on purpose: waiting for each answer before asking the next
  // is all the throttling we need.
  for (const { itemId } of batch) {
    try {
      const item = await source.getItem(itemId);
      if (item) {
        markOk.run(item.name, item.quality ?? null, now, itemId);
        found++;
      } else {
        markMissing.run(now, itemId);
        missing++;
      }
    } catch (err) {
      // If one lookup fails after the source's own retries, the rest probably
      // would too. Stop and leave them for the next run.
      error = err instanceof Error ? err.message : String(err);
      break;
    }
  }

  const row = db
    .prepare<{ retryMissingBefore: number }, { n: number }>(`SELECT COUNT(*) AS n FROM items WHERE ${DUE}`)
    .get({ retryMissingBefore });

  return { found, missing, remaining: row?.n ?? 0, ...(error === undefined ? {} : { error }) };
}
