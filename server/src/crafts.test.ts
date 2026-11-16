import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectOnce } from "./collector.js";
import { findCrafts } from "./crafts.js";
import type { DataSource } from "./dataSource.js";
import { openDb } from "./db.js";
import type { Profession } from "./levelling.js";
import type { CommodityListing } from "./types.js";

// Items: 1 herb, 2 oil (made from 2 herbs), 3 potion (1 oil + 1 vial), 9 vendor vial (5c).
const TEST: Profession = {
  id: "test",
  name: "Test",
  recipes: [
    { spellId: 10, name: "Oil", learn: 1, yellow: 10, grey: 20, makes: { itemId: 2, quantity: 1 }, reagents: [{ itemId: 1, quantity: 2 }] },
    { spellId: 11, name: "Potion", learn: 5, yellow: 10, grey: 20, makes: { itemId: 3, quantity: 2 }, reagents: [{ itemId: 2, quantity: 1 }, { itemId: 9, quantity: 1 }] },
    { spellId: 12, name: "Enchant", learn: 5, yellow: 10, grey: 20, makes: { itemId: 0, quantity: 0 }, reagents: [{ itemId: 1, quantity: 1 }] },
    { spellId: 13, name: "Rare", learn: 5, yellow: 10, grey: 20, makes: { itemId: 3, quantity: 1 }, reagents: [{ itemId: 77, quantity: 1 }] },
  ],
  vendorPrices: { 9: 5 },
  itemNames: { 1: "Herb", 2: "Oil", 3: "Potion", 9: "Vial" },
};

async function dbWith(listings: Array<[number, number, number]>, gear: Array<[number, number]> = []) {
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
    getItem: async () => null,
    fetchSnapshot: async () => ({
      houseId: 113,
      takenAt: 1000,
      items: gear.map(([itemId, buyout]) => ({ id: id++, item: { id: itemId }, quantity: 1, buyout, time_left: "LONG" as const })),
      commodities,
    }),
  };
  await collectOnce({ db, source, rulesetId: 1, houseId: 113 });
  return db;
}

describe("findCrafts", () => {
  it("prices gear from its cheapest listing, or a vendor when that pays more", async () => {
    const smith: Profession = {
      ...TEST,
      recipes: [
        { spellId: 20, name: "Helm", learn: 5, yellow: 10, grey: 20, makes: { itemId: 40, quantity: 1 }, reagents: [{ itemId: 1, quantity: 10 }] },
        { spellId: 21, name: "Boots", learn: 5, yellow: 10, grey: 20, makes: { itemId: 41, quantity: 1 }, reagents: [{ itemId: 1, quantity: 10 }] },
        { spellId: 22, name: "Belt", learn: 5, yellow: 10, grey: 20, makes: { itemId: 42, quantity: 1 }, reagents: [{ itemId: 1, quantity: 10 }] },
      ],
    };
    // Herb 10c. Helms listed from 500c; Boots from 120c, but a vendor pays 150c; no Belt listed or vendor price.
    const db = await dbWith([[1, 10, 1000]], [[40, 900], [40, 500], [41, 120]]);
    db.prepare("UPDATE items SET sell_price = ? WHERE item_id = ?").run(150, 41);
    const { crafts } = findCrafts(db, 113, [smith], 0.05);

    assert.deepEqual(
      crafts.map((c) => [c.name, c.kind, c.cost, c.sale, c.saleTo, c.listed, c.count, c.totalProfit, c.soldPerDay]),
      [
        ["Helm", "gear", 100, 475, "auction", 2, 1, 375, null],
        ["Boots", "gear", 100, 150, "vendor", 1, 1, 50, null],
      ],
    );
  });

  it("prices a craft from its materials and the sale after the AH cut", async () => {
    // Herb 10c, Oil 50c to buy (20c to make), Potion sells at 100c.
    const db = await dbWith([[1, 10, 100], [2, 50, 100], [3, 100, 40]]);
    const { takenAt, crafts } = findCrafts(db, 113, [TEST], 0.05);

    assert.equal(takenAt, 1000);
    assert.deepEqual(
      crafts.map((c) => [c.name, c.cost, c.sale, c.profit, c.listed]),
      [
        ["Potion", 25, 190, 165, 40], // made oil 20 + vial 5; 2 x 100 less 5%
        ["Oil", 20, 47, 27, 100],
      ],
    );
    assert.deepEqual(
      crafts[0]?.materials.map((m) => [m.name, m.unitCost, m.source]),
      [
        ["Oil", 20, "crafted"],
        ["Vial", 5, "vendor"],
      ],
    );
  });

  it("buys a material when that is cheaper than making it", async () => {
    const db = await dbWith([[1, 10, 100], [2, 15, 100], [3, 100, 40]]);
    const potion = findCrafts(db, 113, [TEST], 0.05).crafts.find((c) => c.name === "Potion");
    assert.deepEqual([potion?.cost, potion?.materials[0]?.source], [20, "auction"]);
  });

  it("counts the crafts worth making as materials get dearer", async () => {
    // Oil sells at 100c (95c after the cut). Herbs: 6 at 10c, 4 at 40c, then 60c.
    // An Oil takes 2 herbs: 20c, 20c, 20c, then 80c, 80c, then 120c.
    const db = await dbWith([[1, 10, 6], [1, 40, 4], [1, 60, 100], [2, 100, 50]]);
    const oil = findCrafts(db, 113, [TEST], 0.05).crafts.find((c) => c.name === "Oil");

    assert.deepEqual(
      [oil?.count, oil?.totalCost, oil?.totalProfit, oil?.limited, oil?.heldBy],
      [5, 220, 5 * 95 - 220, false, "materials"],
    );
  });

  it("prices exactly the number of crafts asked for, or as many as the market allows", async () => {
    const db = await dbWith([[1, 10, 6], [1, 40, 4], [2, 100, 50]]);
    const oil = (wanted: number) => findCrafts(db, 113, [TEST], 0.05, wanted).crafts.find((c) => c.name === "Oil");

    assert.deepEqual([oil(2)?.count, oil(2)?.totalCost, oil(2)?.limited], [2, 40, false]);
    // Only 10 herbs are listed: enough for 5.
    assert.deepEqual([oil(8)?.count, oil(8)?.totalCost, oil(8)?.limited], [5, 220, true]);
  });

  it("leaves out crafts with no product on sale or a missing material", async () => {
    const db = await dbWith([[1, 10, 100]]);
    assert.deepEqual(findCrafts(db, 113, [TEST], 0.05).crafts, []);
    assert.deepEqual(findCrafts(openDb(":memory:"), 113, [TEST], 0.05), { takenAt: null, crafts: [] });
  });
});
