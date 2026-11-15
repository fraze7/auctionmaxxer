import { summarizeCommodities, summarizeItems } from "./aggregate.js";
import type { DataSource } from "./dataSource.js";
import type { Db } from "./db.js";

// One collector run: fetch a house's latest snapshot, summarise and store it.
// Commodities, plus a price per item for one-at-a-time listings. A bad fetch never throws: it is recorded as a
// 'failed' row so gaps in the history are visible.

const KIND = "commodities";

// Zod errors can be huge; the start is enough.
const MAX_ERROR_LENGTH = 2000;

export interface CollectOptions {
  db: Db;
  source: DataSource;
  rulesetId: number;
  houseId: number;
  // Unix seconds. Only tests pass this.
  now?: () => number;
}

export type CollectResult =
  // 'empty' = the house had no commodity listings, which is not an error.
  | {
      status: "ok" | "empty";
      snapshotId: number;
      takenAt: number;
      listingCount: number;
      itemCount: number;
      singleCount: number; // items sold one at a time that got a price
      singlesError?: string; // those could not be stored; the commodities were
    }
  // Nothing newer than what is stored; nothing written.
  | { status: "skipped"; lastTakenAt: number }
  // A 'failed' row was recorded.
  | { status: "failed"; snapshotId: number; error: string };

export async function collectOnce(options: CollectOptions): Promise<CollectResult> {
  const { db, source, rulesetId, houseId } = options;
  const fetchedAt = (options.now ?? currentUnixSeconds)();

  try {
    const lastTakenAt = latestTakenAt(db, houseId);
    const snapshot = await source.fetchSnapshot(houseId, lastTakenAt ?? undefined);

    // null = nothing new; the second check covers a source that returns an old snapshot.
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
    // OR IGNORE: known items keep their row; new ones are queued as 'pending'.
    const queueItem = db.prepare("INSERT OR IGNORE INTO items (item_id, first_seen) VALUES (?, ?)");

    // One transaction per snapshot: all or nothing, and much faster.
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

    // One-at-a-time listings are stored afterwards and on their own, so a
    // problem with them can never cost the snapshot's commodity prices.
    let singleCount = 0;
    let singlesError: string | undefined;
    try {
      const singles = summarizeItems(snapshot.items);
      const insertSingle = db.prepare(`
        INSERT INTO item_prices (snapshot_id, item_id, min_buyout, median_buyout, listing_count)
        VALUES (?, ?, ?, ?, ?)
      `);
      const queueSingle = db.prepare("INSERT OR IGNORE INTO items (item_id, first_seen, kind) VALUES (?, ?, 'single')");
      db.transaction(() => {
        for (const s of singles) {
          insertSingle.run(snapshotId, s.itemId, s.minBuyout, s.medianBuyout, s.listingCount);
          queueSingle.run(s.itemId, snapshot.takenAt);
        }
      })();
      singleCount = singles.length;
    } catch (err) {
      singlesError = errorMessage(err).slice(0, MAX_ERROR_LENGTH);
    }

    return {
      status,
      snapshotId,
      takenAt: snapshot.takenAt,
      listingCount: snapshot.commodities.length,
      itemCount: summaries.length,
      singleCount,
      ...(singlesError === undefined ? {} : { singlesError }),
    };
  } catch (err) {
    const error = errorMessage(err).slice(0, MAX_ERROR_LENGTH);
    const { lastInsertRowid } = db
      .prepare(
        `
        INSERT INTO snapshots (ruleset_id, house_id, kind, fetched_at, status, error)
        VALUES (?, ?, ?, ?, 'failed', ?)
      `,
      )
      .run(rulesetId, houseId, KIND, fetchedAt, error);
    return { status: "failed", snapshotId: Number(lastInsertRowid), error };
  }
}

// When the newest stored snapshot was taken, or null. Failed rows have no taken_at.
function latestTakenAt(db: Db, houseId: number): number | null {
  const row = db
    .prepare<[number, string], { takenAt: number | null }>(
      `
      SELECT MAX(taken_at) AS takenAt
      FROM snapshots
      WHERE house_id = ? AND kind = ? AND status IN ('ok', 'empty')
    `,
    )
    .get(houseId, KIND);
  return row?.takenAt ?? null;
}

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
