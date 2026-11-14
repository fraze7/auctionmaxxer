import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectOnce } from "./collector.js";
import type { DataSource } from "./dataSource.js";
import { openDb } from "./db.js";
import { findResets } from "./resets.js";
import type { CommodityListing } from "./types.js";

const HOUR = 3600;

// Twelve hourly snapshots of `past`, then one of `now`. Listings are [itemId, unitPrice, quantity].
async function dbWith(past: Array<[number, number, number]>, now: Array<[number, number, number]>) {
  const db = openDb(":memory:");
  let id = 1;
  const snapshots = [...Array.from({ length: 12 }, () => past), now];
  for (const [index, listings] of snapshots.entries()) {
    const commodities: CommodityListing[] = listings.map(([itemId, unitPrice, quantity]) => ({
      id: id++,
      item: { id: itemId },
      quantity,
      unit_price: unitPrice,
      time_left: "LONG",
    }));
    const source: DataSource = {
      listHouses: async () => [],
      getItem: async () => null,
      fetchSnapshot: async () => ({ houseId: 113, takenAt: (100 + index) * HOUR, items: [], commodities }),
    };
    await collectOnce({ db, source, rulesetId: 1, houseId: 113 });
  }
  return db;
}

const find = (db: Awaited<ReturnType<typeof dbWith>>, maxCost = 1_000_000, minRise = 1.5) =>
  findResets({ db, houseId: 113, ahCut: 0.05, maxCost, minRise, limit: 50 });

describe("findResets", () => {
  it("finds the buyout that leaves a much higher cheapest price", async () => {
    // Normally 100c. Now 10 at 40c and 5 at 50c sit under a wall at 120c.
    const db = await dbWith([[1, 100, 50]], [[1, 40, 10], [1, 50, 5], [1, 120, 200]]);
    const { resets } = find(db);

    // Buy 15 for 650c; relist at 119c less 5% = 113c each.
    assert.deepEqual(resets, [
      {
        id: 1,
        name: null,
        quality: null,
        units: 15,
        cost: 650,
        floor: 40,
        newFloor: 120,
        normal: 100,
        remaining: 200,
        profit: 15 * 113 - 650,
      },
    ]);
  });

  it("ignores a wall far above the normal price", async () => {
    const db = await dbWith([[1, 100, 50]], [[1, 90, 10], [1, 500, 200]]);
    assert.deepEqual(find(db).resets, []);
  });

  it("ignores a rise smaller than the minimum", async () => {
    const db = await dbWith([[1, 100, 50]], [[1, 90, 10], [1, 110, 200]]);
    assert.deepEqual(find(db).resets, []);
    assert.equal(find(db, 1_000_000, 1.2).resets.length, 1);
  });

  it("stays within the budget", async () => {
    const db = await dbWith([[1, 100, 50]], [[1, 40, 10], [1, 50, 5], [1, 120, 200]]);
    // 400c buys the first level only, and 50c is not enough of a rise.
    assert.deepEqual(find(db, 400).resets, []);
  });

  it("needs some price history", async () => {
    const db = await dbWith([], [[1, 40, 10], [1, 120, 200]]);
    assert.deepEqual(find(db).resets, []);
    assert.deepEqual(find(openDb(":memory:")), { takenAt: null, resets: [] });
  });
});
