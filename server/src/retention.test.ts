// Tests for pruning old price levels.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openDb, type Db } from "./db.js";
import { pruneOldLevels } from "./retention.js";

const DAY = 24 * 60 * 60;
const NOW = 1_800_000_000;

// One snapshot with one item: a price row and two price levels.
function addSnapshot(db: Db, takenAt: number): number {
  const { lastInsertRowid } = db
    .prepare(
      "INSERT INTO snapshots (ruleset_id, house_id, kind, taken_at, fetched_at, status, listing_count) VALUES (1, 113, 'commodities', ?, ?, 'ok', 2)",
    )
    .run(takenAt, takenAt);
  const id = Number(lastInsertRowid);
  db.prepare("INSERT INTO commodity_prices VALUES (?, 2447, 36, 40, 10, 5, 2)").run(id);
  db.prepare("INSERT INTO price_levels VALUES (?, 2447, 0, 36, 5), (?, 2447, 1, 40, 5)").run(id, id);
  return id;
}

const count = (db: Db, table: string) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe("pruneOldLevels", () => {
  it("deletes levels older than 14 days and keeps newer ones", () => {
    const db = openDb(":memory:");
    addSnapshot(db, NOW - 15 * DAY);
    const recent = addSnapshot(db, NOW - 13 * DAY);

    assert.equal(pruneOldLevels({ db, now: () => NOW }), 2);

    const left = db.prepare("SELECT DISTINCT snapshot_id FROM price_levels").all();
    assert.deepEqual(left, [{ snapshot_id: recent }]);
  });

  it("never touches the long-term price history", () => {
    const db = openDb(":memory:");
    addSnapshot(db, NOW - 100 * DAY);

    pruneOldLevels({ db, now: () => NOW });

    assert.equal(count(db, "price_levels"), 0);
    assert.equal(count(db, "commodity_prices"), 1);
    assert.equal(count(db, "snapshots"), 1);
  });

  it("does nothing when everything is recent", () => {
    const db = openDb(":memory:");
    addSnapshot(db, NOW - DAY);
    assert.equal(pruneOldLevels({ db, now: () => NOW }), 0);
    assert.equal(count(db, "price_levels"), 2);
  });
});
