import { summarizeCommodities } from "./aggregate.js";
import type { DataSource } from "./dataSource.js";
import type { Db } from "./db.js";

// One collector run: fetch the latest snapshot for one house, summarise it,
// and store the summaries. v1 tracks commodities only; item (gear) listings
// are fetched by the source but not stored yet.
//
// The collector never knows which DataSource it was given, and it never
// throws for a bad fetch: a failure becomes a 'failed' row in `snapshots`, so
// a gap in the history is visible instead of silent.

const KIND = "commodities";

// Zod errors can list thousands of bad listings. Keep the start, which is
// enough to see what went wrong, and don't bloat the database.
const MAX_ERROR_LENGTH = 2000;

export interface CollectOptions {
  db: Db;
  source: DataSource;
  rulesetId: number;
  houseId: number;
  // Current time in Unix seconds. Only tests pass this, to get fixed times.
  now?: () => number;
}

export type CollectResult =
  // Stored a new snapshot. 'empty' means the house had no commodity listings,
  // which is normal for some houses and not an error.
  | { status: "ok" | "empty"; snapshotId: number; takenAt: number; listingCount: number; itemCount: number }
  // Blizzard had nothing newer than what we already stored. Nothing written.
  | { status: "skipped"; lastTakenAt: number }
  // The fetch or the write failed. A 'failed' row was recorded.
  | { status: "failed"; snapshotId: number; error: string };

export async function collectOnce(options: CollectOptions): Promise<CollectResult> {
  const { db, source, rulesetId, houseId } = options;
  const fetchedAt = (options.now ?? currentUnixSeconds)();

  try {
    const lastTakenAt = latestTakenAt(db, houseId);
    const snapshot = await source.fetchSnapshot(houseId, lastTakenAt ?? undefined);

    // The source returns null when there's nothing new. The second check
    // covers a source that hands back an old snapshot anyway.
    if (lastTakenAt !== null && (snapshot === null || snapshot.takenAt <= lastTakenAt)) {
      return { status: "skipped", lastTakenAt };
    }
    if (snapshot === null) {
      throw new Error("Source returned no snapshot, although none is stored yet");
    }

    const summaries = summarizeCommodities(snapshot.commodities);
    const status = snapshot.commodities.length === 0 ? "empty" : "ok";

    const insertSnapshot = db.prepare(`
      INSERT INTO snapshots (ruleset_id, house_id, kind, taken_at, fetched_at, status, listing_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertPrice = db.prepare(`
      INSERT INTO commodity_prices
        (snapshot_id, item_id, min_price, median_price, quantity, qty_at_min, listing_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertLevel = db.prepare(`
      INSERT INTO price_levels (snapshot_id, item_id, level, unit_price, quantity)
      VALUES (?, ?, ?, ?, ?)
    `);
    // OR IGNORE: an item we've seen before keeps its existing row (and name).
    // A new one joins the name-backfill queue as 'pending' (the default).
    const queueItem = db.prepare("INSERT OR IGNORE INTO items (item_id, first_seen) VALUES (?, ?)");

    // Everything for one snapshot goes in a single transaction: if any insert
    // fails, SQLite undoes all of them, so a half-written snapshot can't exist.
    // It's also far faster than committing tens of thousands of rows one by one.
    const snapshotId = db.transaction(() => {
      const { lastInsertRowid } = insertSnapshot.run(
        rulesetId,
        houseId,
        KIND,
        snapshot.takenAt,
        fetchedAt,
        status,
        snapshot.commodities.length,
      );
      const id = Number(lastInsertRowid);

      for (const s of summaries) {
        insertPrice.run(id, s.itemId, s.minPrice, s.medianPrice, s.quantity, s.qtyAtMin, s.listingCount);
        s.levels.forEach((level, index) => {
          insertLevel.run(id, s.itemId, index, level.unitPrice, level.quantity);
        });
        queueItem.run(s.itemId, snapshot.takenAt);
      }
      return id;
    })();

    return {
      status,
      snapshotId,
      takenAt: snapshot.takenAt,
      listingCount: snapshot.commodities.length,
      itemCount: summaries.length,
    };
  } catch (err) {
    const error = errorMessage(err).slice(0, MAX_ERROR_LENGTH);
    const { lastInsertRowid } = db
      .prepare(`
        INSERT INTO snapshots (ruleset_id, house_id, kind, fetched_at, status, error)
        VALUES (?, ?, ?, ?, 'failed', ?)
      `)
      .run(rulesetId, houseId, KIND, fetchedAt, error);
    return { status: "failed", snapshotId: Number(lastInsertRowid), error };
  }
}

// When Blizzard took the newest snapshot we have stored for this house, or
// null if we have none. Failed rows don't count: their taken_at is NULL.
function latestTakenAt(db: Db, houseId: number): number | null {
  const row = db
    .prepare<[number, string], { takenAt: number | null }>(`
      SELECT MAX(taken_at) AS takenAt
      FROM snapshots
      WHERE house_id = ? AND kind = ? AND status IN ('ok', 'empty')
    `)
    .get(houseId, KIND);
  return row?.takenAt ?? null;
}

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
