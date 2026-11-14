import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectOnce } from "./collector.js";
import type { DataSource } from "./dataSource.js";
import { openDb } from "./db.js";
import { estimateSales } from "./liquidity.js";
import type { CommodityListing } from "./types.js";

const HOUR = 3600;

// Each snapshot: [hour, [itemId, unitPrice, quantity][]]
async function dbWith(snapshots: Array<[number, Array<[number, number, number]>]>) {
  const db = openDb(":memory:");
  let id = 1;
  for (const [hour, listings] of snapshots) {
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
      fetchSnapshot: async () => ({ houseId: 113, takenAt: hour * HOUR, items: [], commodities }),
    };
    await collectOnce({ db, source, rulesetId: 1, houseId: 113 });
  }
  return db;
}

describe("estimateSales", () => {
  it("counts units that vanish from the cheap end of the order book", async () => {
    const db = await dbWith([
      [0, [[1, 10, 30], [1, 20, 40], [1, 50, 100], [2, 5, 10], [3, 7, 8]]],
      // Item 1: all 30 at 10c went, and 15 of the 40 at 20c. Item 2: untouched. Item 3: gone.
      [12, [[1, 20, 25], [1, 50, 100], [2, 5, 10]]],
      // Item 1: cheaper listings arrived and nothing sold. Item 2: the price fell.
      [24, [[1, 15, 5], [1, 20, 25], [1, 50, 100], [2, 4, 10]]],
    ]);
    const { coveredDays, soldPerDay } = estimateSales(db, 113);

    assert.equal(coveredDays, 1);
    assert.deepEqual([soldPerDay.get(1), soldPerDay.get(2), soldPerDay.get(3)], [45, 0, 8]);
  });

  it("gives no estimate from under half a day of history", async () => {
    const db = await dbWith([
      [0, [[1, 10, 30]]],
      [6, [[1, 20, 30]]],
    ]);
    assert.equal(estimateSales(db, 113).soldPerDay.size, 0);
    assert.equal(estimateSales(openDb(":memory:"), 113).soldPerDay.size, 0);
  });
});
