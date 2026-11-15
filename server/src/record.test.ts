import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectOnce } from "./collector.js";
import type { DataSource } from "./dataSource.js";
import { openDb, type Db } from "./db.js";
import { loadTrackRecord, recordRecommendations } from "./record.js";
import { loadSettings } from "./settings.js";
import type { CommodityListing } from "./types.js";

const HOUR = 3600;

// Listings are [itemId, unitPrice, quantity].
async function snapshot(db: Db, hour: number, listings: Array<[number, number, number]>) {
  const commodities: CommodityListing[] = listings.map(([itemId, unitPrice, quantity], index) => ({
    id: hour * 1000 + index,
    item: { id: itemId },
    quantity,
    unit_price: unitPrice,
    time_left: "LONG",
  }));
  const source: DataSource = {
    listHouses: async () => [],
    getItem: async () => null,
    fetchSnapshot: async () => ({ houseId: 113, takenAt: hour * HOUR, items: [], commodities }),
  };
  await collectOnce({ db, source, rulesetId: 1, houseId: 113 });
}

// Twelve hours at 100c, then 10 at 40c and 5 at 50c under a wall at 120c: a reset.
async function dbWithReset() {
  const db = openDb(":memory:");
  for (let hour = 1; hour <= 12; hour++) await snapshot(db, hour, [[1, 100, 50]]);
  await snapshot(db, 13, [[1, 40, 10], [1, 50, 5], [1, 120, 200]]);
  return db;
}

const record = (db: Db) => recordRecommendations({ db, houseId: 113, settings: loadSettings(db) });

describe("the track record", () => {
  it("saves a pick once, however long it stays on the list", async () => {
    const db = await dbWithReset();
    assert.equal(record(db), 1);
    assert.equal(record(db), 0);

    await snapshot(db, 14, [[1, 40, 10], [1, 50, 5], [1, 120, 200]]);
    assert.equal(record(db), 0); // same item within a day

    const { recent, summary } = loadTrackRecord(db, 113, 0.05);
    assert.deepEqual(
      recent.map((o) => [o.kind, o.itemId, o.units, o.cost, o.expectedProfit, o.status, o.actualProfit]),
      [["reset", 1, 15, 650, 15 * 113 - 650, "pending", null]],
    );
    assert.deepEqual(
      summary.map((s) => [s.kind, s.saved, s.judged]),
      [
        ["deal", 0, 0],
        ["reset", 1, 0],
      ],
    );
  });

  it("judges a pick against the cheapest price a day later", async () => {
    const db = await dbWithReset();
    record(db);
    await snapshot(db, 13 + 24, [[1, 90, 300]]);

    const { since, recent, summary } = loadTrackRecord(db, 113, 0.05);
    // 15 units at 90c less 5% = 85c each, against 650c paid.
    assert.equal(since, 13 * HOUR);
    assert.deepEqual(
      recent.map((o) => [o.status, o.laterPrice, o.actualProfit]),
      [["judged", 90, 15 * 85 - 650]],
    );
    assert.deepEqual(summary[1], {
      kind: "reset",
      saved: 1,
      judged: 1,
      profitable: 1,
      cost: 650,
      expectedProfit: 15 * 113 - 650,
      actualProfit: 15 * 85 - 650,
    });
  });

  it("marks a pick unlisted when the item is not on sale a day later", async () => {
    const db = await dbWithReset();
    record(db);
    await snapshot(db, 13 + 30, [[2, 5, 5]]);

    const { recent, summary } = loadTrackRecord(db, 113, 0.05);
    assert.deepEqual([recent[0]?.status, recent[0]?.actualProfit], ["unlisted", null]);
    assert.equal(summary[1]?.judged, 0);
  });

  it("copes with nothing saved", () => {
    const db = openDb(":memory:");
    assert.equal(record(db), 0);
    assert.deepEqual(loadTrackRecord(db, 113, 0.05).recent, []);
    assert.equal(loadTrackRecord(db, 113, 0.05).since, null);
  });
});
