import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectOnce } from "./collector.js";
import type { DataSource } from "./dataSource.js";
import { openDb } from "./db.js";
import { findMovers } from "./movers.js";
import type { CommodityListing } from "./types.js";

const HOUR = 3600;

// Each snapshot: [takenAt, [itemId, unitPrice, quantity][]]
async function dbWith(snapshots: Array<[number, Array<[number, number, number]>]>) {
  const db = openDb(":memory:");
  let id = 1;
  for (const [takenAt, listings] of snapshots) {
    // Five equal listings per item, so each counts as widely listed.
    const commodities: CommodityListing[] = listings.flatMap(([itemId, unitPrice, quantity]) =>
      Array.from({ length: quantity >= 5 ? 5 : 1 }, () => ({
        id: id++,
        item: { id: itemId },
        quantity: quantity >= 5 ? quantity / 5 : quantity,
        unit_price: unitPrice,
        time_left: "LONG" as const,
      })),
    );
    const source: DataSource = {
      listHouses: async () => [],
      getItem: async () => null,
      fetchSnapshot: async () => ({ houseId: 113, takenAt, items: [], commodities }),
    };
    await collectOnce({ db, source, rulesetId: 1, houseId: 113 });
  }
  return db;
}

const find = (db: Awaited<ReturnType<typeof dbWith>>, hours = 24, minQuantity = 50) =>
  findMovers({ db, houseId: 113, hours, minQuantity, limit: 25 });

describe("findMovers", () => {
  it("lists the biggest risers and fallers against the snapshot a day earlier", async () => {
    const db = await dbWith([
      [100 * HOUR, [[1, 100, 100], [2, 100, 100], [3, 100, 100], [4, 100, 100]]],
      [110 * HOUR, [[1, 999, 100]]], // too recent to compare with
      [124 * HOUR, [[1, 150, 100], [2, 300, 100], [3, 50, 100], [4, 100, 100]]],
    ]);
    const movers = find(db);

    assert.deepEqual([movers.takenAt, movers.comparedTo], [124 * HOUR, 100 * HOUR]);
    assert.deepEqual(
      movers.risers.map((m) => [m.id, m.before, m.now, m.change]),
      [
        [2, 100, 300, 3],
        [1, 100, 150, 1.5],
      ],
    );
    assert.deepEqual(
      movers.fallers.map((m) => [m.id, m.change]),
      [[3, 0.5]],
    );
  });

  it("leaves out thinly traded items and items new to the auction house", async () => {
    const db = await dbWith([
      [100 * HOUR, [[1, 100, 100], [2, 100, 1]]],
      [124 * HOUR, [[1, 200, 10], [2, 200, 100], [3, 200, 100]]],
    ]);
    // 1: only 10 on sale now. 2: only 1 was on sale before. 3: not on sale before.
    assert.deepEqual(find(db).risers, []);
  });

  it("ignores a median dragged up while the cheapest listing has not moved", async () => {
    const db = openDb(":memory:");
    let id = 1;
    const snapshot = async (takenAt: number, listings: Array<[number, number]>) => {
      const source: DataSource = {
        listHouses: async () => [],
        getItem: async () => null,
        fetchSnapshot: async () => ({
          houseId: 113,
          takenAt,
          items: [],
          commodities: listings.map(([unit_price, quantity]) => ({ id: id++, item: { id: 1 }, quantity, unit_price, time_left: "LONG" as const })),
        }),
      };
      await collectOnce({ db, source, rulesetId: 1, houseId: 113 });
    };
    await snapshot(100 * HOUR, [[10, 20], [10, 20], [10, 20], [10, 20], [10, 20]]);
    // Still 10c at the cheapest, but someone has listed 500 at 5g.
    await snapshot(124 * HOUR, [[10, 20], [10, 20], [10, 20], [10, 20], [50_000, 500]]);

    assert.deepEqual(find(db).risers, []);
  });

  it("falls back to the oldest snapshot when there is not enough history", async () => {
    const db = await dbWith([
      [100 * HOUR, [[1, 100, 100]]],
      [103 * HOUR, [[1, 200, 100]]],
    ]);
    const movers = find(db, 24 * 7);
    assert.equal(movers.comparedTo, 100 * HOUR);
    assert.equal(movers.risers.length, 1);
  });

  it("copes with one snapshot or none", async () => {
    assert.deepEqual(find(openDb(":memory:")), { takenAt: null, comparedTo: null, risers: [], fallers: [] });
    const db = await dbWith([[100 * HOUR, [[1, 100, 100]]]]);
    assert.deepEqual(find(db), { takenAt: 100 * HOUR, comparedTo: null, risers: [], fallers: [] });
  });
});
