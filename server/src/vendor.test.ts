import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { backfillItems } from "./backfill.js";
import { collectOnce } from "./collector.js";
import type { DataSource } from "./dataSource.js";
import { openDb } from "./db.js";
import type { CommodityListing, ItemInfo } from "./types.js";
import { findVendorDeals } from "./vendor.js";

// [itemId, unitPrice, quantity]
async function dbWith(listings: Array<[number, number, number]>, items: ItemInfo[]) {
  const db = openDb(":memory:");
  let id = 1;
  const commodities: CommodityListing[] = listings.map(([itemId, unitPrice, quantity]) => ({
    id: id++,
    item: { id: itemId },
    quantity,
    unit_price: unitPrice,
    time_left: "LONG",
  }));
  const source: DataSource = {
    listHouses: async () => [],
    getItem: async (itemId) => items.find((item) => item.id === itemId) ?? null,
    fetchSnapshot: async () => ({ houseId: 113, takenAt: 1000, items: [], commodities }),
  };
  await collectOnce({ db, source, rulesetId: 1, houseId: 113 });
  await backfillItems({ db, source });
  return { db, source };
}

describe("findVendorDeals", () => {
  it("lists items on sale for less than a vendor pays, with the profit for buying them all", async () => {
    const { db } = await dbWith(
      [[1, 10, 5], [1, 30, 20], [1, 60, 100], [2, 80, 10], [3, 5, 10], [4, 1, 10]],
      [
        { id: 1, name: "Pelt", sellPrice: 50 },
        { id: 2, name: "Ore", sellPrice: 50 }, // listed above the vendor price
        { id: 3, name: "Junk", sellPrice: 0 }, // vendors do not buy it
        { id: 4, name: "Odd" }, // Blizzard gave no price
      ],
    );
    const result = findVendorDeals(db, 113);

    assert.deepEqual([result.takenAt, result.priced, result.unpriced], [1000, 4, 0]);
    assert.deepEqual(result.deals, [
      // 5 at 10c and 20 at 30c are below 50c: cost 650, sells for 1,250.
      { id: 1, name: "Pelt", quality: null, vendorPrice: 50, minPrice: 10, quantity: 25, cost: 650, profit: 600 },
    ]);
  });

  it("looks up the vendor price of items named before the price was stored", async () => {
    const { db, source } = await dbWith([[1, 10, 5]], [{ id: 1, name: "Pelt", sellPrice: 50 }]);
    db.prepare("UPDATE items SET sell_price = NULL").run();
    assert.deepEqual([findVendorDeals(db, 113).unpriced, findVendorDeals(db, 113).deals.length], [1, 0]);

    const run = await backfillItems({ db, source });
    assert.deepEqual([run.found, run.remaining], [1, 0]);
    assert.equal(findVendorDeals(db, 113).deals.length, 1);
  });

  it("copes with no snapshots", () => {
    assert.deepEqual(findVendorDeals(openDb(":memory:"), 113), { takenAt: null, priced: 0, unpriced: 0, deals: [] });
  });
});
