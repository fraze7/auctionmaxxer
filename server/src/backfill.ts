import type { DataSource } from "./dataSource.js";
import type { Db } from "./db.js";

// Looks up names for 'pending' items, a batch per run to stay well inside
// Blizzard's rate limits. Items Blizzard doesn't know become 'missing' and
// are retried after a week.

export const DEFAULT_BATCH_SIZE = 100;
const RETRY_MISSING_AFTER_SECONDS = 7 * 24 * 60 * 60;

export interface BackfillOptions {
  db: Db;
  source: DataSource;
  limit?: number;
  // Unix seconds. Only tests pass this.
  now?: () => number;
}

export interface BackfillResult {
  found: number; // now 'ok'
  missing: number; // now 'missing'
  remaining: number; // still waiting for a later run
  // Set when a lookup failed; the batch stops and the item stays queued.
  error?: string;
}

export async function backfillItems(options: BackfillOptions): Promise<BackfillResult> {
  const { db, source } = options;
  const limit = options.limit ?? DEFAULT_BATCH_SIZE;
  const now = (options.now ?? (() => Math.floor(Date.now() / 1000)))();
  const retryMissingBefore = now - RETRY_MISSING_AFTER_SECONDS;

  // Never-tried items first, then stale 'missing' ones.
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

  // One at a time: that is all the throttling needed.
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
      // The rest would probably fail too; leave them for the next run.
      error = err instanceof Error ? err.message : String(err);
      break;
    }
  }

  const row = db
    .prepare<{ retryMissingBefore: number }, { n: number }>(`SELECT COUNT(*) AS n FROM items WHERE ${DUE}`)
    .get({ retryMissingBefore });

  return { found, missing, remaining: row?.n ?? 0, ...(error === undefined ? {} : { error }) };
}
