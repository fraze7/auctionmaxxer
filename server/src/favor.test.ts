import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectOnce } from "./collector.js";
import { CRATES, favorFor } from "./crates.js";
import type { DataSource } from "./dataSource.js";
import { openDb } from "./db.js";
import { costToBuy, loadFavorData, planFavor, priceCrates, type Book, type ResolvedCrate } from "./favor.js";
import type { CommodityListing } from "./types.js";

const book = (...levels: Array<[unitPrice: number, quantity: number]>): Book =>
  levels.map(([unitPrice, quantity]) => ({ unitPrice, quantity }));

describe("costToBuy", () => {
  const peacebloom = book([10, 5], [20, 5], [50, 100]);

  it("walks up the price levels as the cheap units run out", () => {
    assert.equal(costToBuy(peacebloom, 5), 50); // all at 10c
    assert.equal(costToBuy(peacebloom, 8), 5 * 10 + 3 * 20);
    assert.equal(costToBuy(peacebloom, 12), 5 * 10 + 5 * 20 + 2 * 50);
  });

  it("skips units an earlier purchase already took", () => {
    // The first 5 (at 10c) are gone.
    assert.equal(costToBuy(peacebloom, 5, 5), 100);
    assert.equal(costToBuy(peacebloom, 4, 8), 2 * 20 + 2 * 50);
  });

  it("returns null when there aren't enough units, or no book at all", () => {
    assert.equal(costToBuy(peacebloom, 111), null);
    assert.equal(costToBuy(peacebloom, 110), 5 * 10 + 5 * 20 + 100 * 50);
    assert.equal(costToBuy(peacebloom, 1, 110), null);
    assert.equal(costToBuy(undefined, 1), null);
  });
});

// Crates 1 and 2; materials 11, 12 and 21.
const HERBS: ResolvedCrate = {
  itemId: 1,
  name: "Test Herbs",
  tier: "Apprentice",
  crafted: false,
  favor: 5,
  favorEstimated: false,
  bundles: [
    { itemId: 11, itemName: "Cheap Herb", quantity: 10 },
    { itemId: 12, itemName: "Dear Herb", quantity: 10 },
    { itemId: null, itemName: "Never Seen Herb", quantity: 1 },
  ],
};
const INGOTS: ResolvedCrate = {
  itemId: 2,
  name: "Test Ingots",
  tier: "Apprentice",
  crafted: true,
  favor: 10,
  favorEstimated: false,
  bundles: [{ itemId: 21, itemName: "Bar", quantity: 20 }],
};

describe("priceCrates", () => {
  it("picks the cheapest bundle and adds the crate's own price", () => {
    const books = new Map([
      [1, book([100, 3])], // the crate itself
      [11, book([4, 50])], // 10 x 4c = 40c
      [12, book([9, 50])], // 10 x 9c = 90c
    ]);
    const [herbs] = priceCrates([HERBS], books);

    assert.equal(herbs?.cratePrice, 100);
    assert.equal(herbs?.cratesListed, 3);
    assert.deepEqual(
      herbs?.bundles.map((b) => [b.itemName, b.cost, b.listed]),
      [
        ["Cheap Herb", 40, 50],
        ["Dear Herb", 90, 50],
        ["Never Seen Herb", null, 0],
      ],
    );
    assert.deepEqual(herbs?.best, {
      bundleIndex: 0,
      crateCost: 100,
      materialsCost: 40,
      totalCost: 140,
      copperPerFavor: 28, // 140c for 5 favor
    });
  });

  it("has no best fill when the crate isn't on sale, or no bundle can be bought", () => {
    const noCrate = new Map([[11, book([4, 50])]]);
    assert.equal(priceCrates([HERBS], noCrate)[0]?.best, null);

    const tooFewHerbs = new Map([
      [1, book([100, 3])],
      [11, book([4, 9])], // needs 10
    ]);
    assert.equal(priceCrates([HERBS], tooFewHerbs)[0]?.best, null);
  });
});

describe("planFavor", () => {
  it("reaches the target with the cheapest fills", () => {
    const books = new Map([
      [1, book([100, 10])],
      [11, book([4, 1000])],
      [2, book([500, 10])],
      [21, book([20, 1000])], // ingots: (500 + 400) / 10 = 90c per favor, herbs: 28c
    ]);
    const plan = planFavor([HERBS, INGOTS], books, 20);

    assert.equal(plan.complete, true);
    assert.equal(plan.favor, 20);
    assert.equal(plan.totalCost, 4 * 140);
    assert.deepEqual(plan.steps, [
      {
        crateId: 1,
        crateName: "Test Herbs",
        favorEach: 5,
        favorEstimated: false,
        bundleItemId: 11,
        bundleItemName: "Cheap Herb",
        bundleQuantity: 10,
        count: 4,
        crateCost: 400,
        materialsCost: 160,
      },
    ]);
  });

  it("switches bundle, then crate, as the cheap listings are used up", () => {
    const books = new Map([
      [1, book([100, 10])],
      [11, book([4, 20])], // enough Cheap Herb for exactly 2 fills
      [12, book([9, 10])], // enough Dear Herb for exactly 1 fill
      [2, book([500, 10])],
      [21, book([20, 1000])],
    ]);
    const plan = planFavor([HERBS, INGOTS], books, 25);

    assert.deepEqual(
      plan.steps.map((s) => [s.crateName, s.bundleItemName, s.count]),
      [
        ["Test Herbs", "Cheap Herb", 2], // 28c per favor, twice
        ["Test Herbs", "Dear Herb", 1], // then 38c per favor
        ["Test Ingots", "Bar", 1], // herbs are gone: 90c per favor
      ],
    );
    assert.equal(plan.favor, 25);
    assert.equal(plan.totalCost, 140 + 140 + 190 + 900);
  });

  it("charges more for each crate as the crate listings themselves get dearer", () => {
    const books = new Map([
      [1, book([100, 1], [300, 5])],
      [11, book([4, 1000])],
    ]);
    const plan = planFavor([HERBS], books, 10);
    assert.equal(plan.steps[0]?.crateCost, 100 + 300);
  });

  it("says so when the market runs out before the target", () => {
    const books = new Map([
      [1, book([100, 2])], // only two crates exist
      [11, book([4, 1000])],
    ]);
    const plan = planFavor([HERBS], books, 500);

    assert.equal(plan.complete, false);
    assert.equal(plan.favor, 10);
    assert.equal(plan.steps[0]?.count, 2);
  });

  it("returns an empty plan when nothing can be bought", () => {
    assert.deepEqual(planFavor([HERBS], new Map(), 30), {
      target: 30,
      favor: 0,
      totalCost: 0,
      complete: false,
      steps: [],
    });
  });
});

describe("loadFavorData", () => {
  it("finds bundle items by name and loads their order books", async () => {
    const db = openDb(":memory:");
    let auctionId = 1;
    const listing = (itemId: number, unitPrice: number, quantity: number): CommodityListing => ({
      id: auctionId++,
      item: { id: itemId },
      quantity,
      unit_price: unitPrice,
      time_left: "LONG",
    });
    const source: DataSource = {
      listHouses: async () => [],
      getItem: async () => null,
      fetchSnapshot: async () => ({
        houseId: 113,
        takenAt: 1000,
        items: [],
        commodities: [listing(248683, 217, 3), listing(2770, 30, 15), listing(2770, 35, 40)],
      }),
    };
    await collectOnce({ db, source, rulesetId: 1, houseId: 113 });
    db.prepare("UPDATE items SET name = 'Copper Ore', status = 'ok' WHERE item_id = 2770").run();

    const data = loadFavorData(db, 113);

    assert.equal(data.takenAt, 1000);
    const ore = data.crates.find((c) => c.itemId === 248683);
    assert.deepEqual(ore?.bundles, [
      { itemId: 2770, itemName: "Copper Ore", quantity: 20 },
      { itemId: null, itemName: "Tin Ore", quantity: 20 }, // never seen: can't be priced
    ]);
    assert.deepEqual(data.books.get(2770), [
      { unitPrice: 30, quantity: 15 },
      { unitPrice: 35, quantity: 40 },
    ]);

    // One crate at 217c + 20 ore for 5 favor.
    const priced = priceCrates(data.crates, data.books).find((c) => c.itemId === 248683);
    assert.equal(priced?.best?.totalCost, 217 + 15 * 30 + 5 * 35);
  });

  it("copes with a house that has no snapshots", () => {
    const data = loadFavorData(openDb(":memory:"), 113);
    assert.equal(data.takenAt, null);
    assert.equal(data.books.size, 0);
    assert.equal(planFavor(data.crates, data.books, 30).favor, 0);
  });
});

describe("the crate table", () => {
  it("has all 30 crates, each with a unique ID and at least two bundles", () => {
    assert.equal(CRATES.length, 30);
    assert.equal(new Set(CRATES.map((c) => c.itemId)).size, 30);
    for (const crate of CRATES) {
      assert.ok(crate.bundles.length >= 2, crate.name);
      assert.ok(crate.name.includes(crate.tier), `${crate.name} should be tier ${crate.tier}`);
      for (const bundle of crate.bundles) assert.ok(bundle.quantity > 0 && bundle.itemName.length > 0);
    }
  });

  it("marks exactly the Fabrics, Ingots and Parts crates as crafted", () => {
    const crafted = CRATES.filter((c) => c.crafted);
    assert.equal(crafted.length, 12);
    assert.ok(crafted.every((c) => /Fabrics|Ingots|Parts/.test(c.name)));
  });

  it("pays double for crafted crates", () => {
    assert.deepEqual(favorFor({ tier: "Apprentice", crafted: false }), { favor: 5, estimated: false });
    assert.deepEqual(favorFor({ tier: "Expert", crafted: true }), { favor: 30, estimated: false });
    assert.deepEqual(favorFor({ tier: "Artisan", crafted: true }), { favor: 40, estimated: false });
  });
});
