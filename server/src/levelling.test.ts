import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectOnce } from "./collector.js";
import type { DataSource } from "./dataSource.js";
import { openDb } from "./db.js";
import {
  loadMarket,
  MAX_SKILL,
  planLevelling,
  skillUpChance,
  type Market,
  type Profession,
  type Recipe,
} from "./levelling.js";
import { ALCHEMY } from "./professions/alchemy.js";
import { BLACKSMITHING } from "./professions/blacksmithing.js";
import type { CommodityListing } from "./types.js";

const recipe = (name: string, learn: number, yellow: number, grey: number, reagents: Array<[number, number]>): Recipe => ({
  spellId: name.length,
  name,
  learn,
  yellow,
  grey,
  makes: { itemId: 900, quantity: 1 },
  reagents: reagents.map(([itemId, quantity]) => ({ itemId, quantity })),
});

// Items: 1 = herb A, 2 = herb B, 9 = vendor vial (5c).
const EARLY = recipe("Early", 1, 10, 20, [[1, 1], [9, 1]]);
const LATE = recipe("Late", 10, 20, 30, [[2, 2], [9, 1]]);
const TEST: Profession = {
  id: "test",
  name: "Test",
  recipes: [EARLY, LATE],
  vendorPrices: { 9: 5 },
  itemNames: { 1: "Herb A", 2: "Herb B", 9: "Vial" },
};

const market = (books: Record<number, Array<[number, number]>>): Market =>
  new Map(
    Object.entries(books).map(([id, levels]) => [
      Number(id),
      {
        book: levels.map(([unitPrice, quantity]) => ({ unitPrice, quantity })),
        exactUnits: levels.reduce((sum, [, quantity]) => sum + quantity, 0),
      },
    ]),
  );

describe("skillUpChance", () => {
  it("is certain below yellow, then falls in a straight line to zero at grey", () => {
    assert.equal(skillUpChance(EARLY, 1), 1);
    assert.equal(skillUpChance(EARLY, 9), 1);
    assert.equal(skillUpChance(EARLY, 10), 1);
    assert.equal(skillUpChance(EARLY, 15), 0.5);
    assert.equal(skillUpChance(EARLY, 19), 0.1);
    assert.equal(skillUpChance(EARLY, 20), 0);
  });

  it("is zero before the recipe can be learned", () => {
    assert.equal(skillUpChance(LATE, 9), 0);
    assert.equal(skillUpChance(LATE, 10), 1);
  });

  it("copes with a recipe that goes straight from orange to grey", () => {
    assert.equal(skillUpChance(recipe("Flat", 20, 20, 20, []), 20), 0);
  });
});

describe("planLevelling", () => {
  it("uses one guaranteed craft per point while a recipe is orange", () => {
    const plan = planLevelling(TEST, market({ 1: [[10, 1000]] }), 1, 10);

    assert.equal(plan.complete, true);
    assert.equal(plan.steps.length, 1);
    const [step] = plan.steps;
    assert.deepEqual(
      [step?.from, step?.to, step?.recipeName, step?.crafts, step?.guaranteed],
      [1, 10, "Early", 9, true],
    );
    assert.equal(plan.totalCost, 9 * 10 + 9 * 5);
    assert.deepEqual(
      step?.materials.map((m) => [m.name, m.quantity, m.cost, m.vendor]),
      [
        ["Herb A", 9, 90, false],
        ["Vial", 9, 45, true],
      ],
    );
  });

  it("switches to the next recipe once it is cheaper per expected point", () => {
    // Early costs 15c a craft and Late 25c, so Early wins until its chance
    // drops below 15/25 = 60%, which happens at skill 15.
    const plan = planLevelling(TEST, market({ 1: [[10, 1000]], 2: [[10, 1000]] }), 1, 20);

    assert.equal(plan.complete, true);
    assert.deepEqual(
      plan.steps.map((s) => [s.recipeName, s.from, s.to]),
      [
        ["Early", 1, 15],
        ["Late", 15, 20],
      ],
    );
    // 14 points: 10 certain + 1/0.9 + 1/0.8 + 1/0.7 + 1/0.6 = 15.46 -> 16 crafts.
    assert.equal(plan.steps[0]?.crafts, 16);
    assert.equal(plan.steps[0]?.guaranteed, false);
    assert.equal(plan.steps[1]?.crafts, 5);
  });

  it("counts extra crafts for points that are not guaranteed", () => {
    const plan = planLevelling(TEST, market({ 1: [[10, 1000]] }), 10, 20);
    // 1/1 + 1/0.9 + ... + 1/0.1 = 29.29 -> 30 crafts for 10 points.
    assert.equal(plan.steps[0]?.crafts, 30);
    assert.equal(plan.reached, 20);
  });

  it("walks up the order book as cheap listings are used", () => {
    const plan = planLevelling(TEST, market({ 1: [[10, 4], [50, 100]] }), 1, 10);
    assert.equal(plan.steps[0]?.materials[0]?.cost, 4 * 10 + 5 * 50);
  });

  // Oil (item 3) is made two at a time from herb A, then used by Potion.
  const oil: Recipe = { ...recipe("Oil", 1, 10, 10, [[1, 1]]), makes: { itemId: 3, quantity: 2 } };
  const potion = recipe("Potion", 10, 30, 40, [[3, 3]]);
  const oily: Profession = { ...TEST, recipes: [oil, potion], itemNames: { ...TEST.itemNames, 3: "Oil" } };

  it("uses what earlier steps made, then crafts the rest from its inputs", () => {
    const plan = planLevelling(oily, market({ 1: [[10, 1000]], 3: [[100, 1000]] }), 1, 20);

    // 9 crafts of Oil leave 18. Ten Potions need 30: 18 from stock, and 12
    // more made from 6 Herb A (5c an Oil, against 100c to buy one).
    assert.deepEqual(
      plan.steps.map((s) => [s.recipeName, s.crafts, s.cost]),
      [
        ["Oil", 9, 90],
        ["Potion", 10, 60],
      ],
    );
    assert.deepEqual(
      plan.steps[1]?.materials.map((m) => [m.name, m.quantity, m.crafted, m.via]),
      [
        ["Oil", 18, 18, undefined],
        ["Herb A", 6, 0, { name: "Oil", quantity: 12 }],
      ],
    );
    assert.deepEqual(
      plan.shopping.map((m) => [m.name, m.quantity, m.cost, m.via]),
      [["Herb A", 15, 150, undefined]],
    );
  });

  it("buys a craftable reagent when that is cheaper than its inputs", () => {
    const plan = planLevelling(oily, market({ 1: [[10, 1000]], 3: [[2, 1000]] }), 1, 20);

    assert.equal(plan.steps[1]?.cost, 12 * 2);
    assert.deepEqual(
      plan.steps[1]?.materials.map((m) => [m.name, m.quantity, m.crafted, m.via]),
      [["Oil", 30, 18, undefined]],
    );
  });

  it("crafts a reagent that is not on sale at all", () => {
    const plan = planLevelling(oily, market({ 1: [[10, 1000]] }), 1, 20);
    assert.equal(plan.complete, true);
    assert.equal(plan.steps[1]?.cost, 60);
  });

  it("skips a recipe when too little of a reagent is listed for the crafts it needs", () => {
    // At skill 19 Early needs 10 crafts; only 3 Herb A are listed, so Late is used.
    const plan = planLevelling(TEST, market({ 1: [[1, 3]], 2: [[10, 1000]] }), 19, 20);
    assert.deepEqual(
      plan.steps.map((s) => [s.recipeName, s.crafts]),
      [["Late", 1]],
    );
  });

  it("covers fewer points when rounding crafts up needs more than is listed", () => {
    // 15 -> 17 expects 1/0.5 + 1/0.4 = 4.5 crafts, which rounds up to 5; only 4.5 are listed.
    const half: Market = new Map([[1, { book: [{ unitPrice: 10, quantity: 4.5 }], exactUnits: 4.5 }]]);
    const plan = planLevelling(TEST, half, 15, 17);
    assert.deepEqual([plan.reached, plan.steps[0]?.crafts], [16, 2]);
  });

  it("carries on with another recipe when a step is cut short", () => {
    // Early is cheapest from 15 but only 4.5 Herb A are listed: enough for one
    // point after rounding. Late takes over from 16.
    const books: Market = new Map([
      [1, { book: [{ unitPrice: 1, quantity: 4.5 }], exactUnits: 4.5 }],
      [2, { book: [{ unitPrice: 10, quantity: 1000 }], exactUnits: 1000 }],
    ]);
    const plan = planLevelling(TEST, books, 15, 20);
    assert.equal(plan.complete, true);
    assert.deepEqual(
      plan.steps.map((s) => [s.recipeName, s.from, s.to]),
      [
        ["Early", 15, 16],
        ["Late", 16, 20],
      ],
    );
  });

  it("stops when the only recipe left costs far more per point", () => {
    // Herb A runs out after 11 points. Late could carry on, at 2,000c a herb.
    const plan = planLevelling(TEST, market({ 1: [[10, 12]], 2: [[2000, 1000]] }), 1, 20);
    assert.deepEqual([plan.reached, plan.complete, plan.tooDear], [12, false, true]);
    assert.deepEqual(
      plan.steps.map((s) => s.recipeName),
      ["Early"],
    );
  });

  it("stops where the market runs out", () => {
    const plan = planLevelling(TEST, market({ 1: [[10, 5]] }), 1, 20);

    assert.equal(plan.complete, false);
    assert.equal(plan.reached, 6);
    assert.equal(plan.tooDear, false);
    assert.equal(plan.steps[0]?.crafts, 5);
  });

  it("returns an empty plan when nothing can be bought", () => {
    const plan = planLevelling(TEST, market({}), 1, 20);
    assert.deepEqual([plan.complete, plan.reached, plan.totalCost, plan.steps.length], [false, 1, 0, 0]);
  });

  it("flags materials priced beyond the stored order book", () => {
    const books: Market = new Map([[1, { book: [{ unitPrice: 10, quantity: 4 }, { unitPrice: 30, quantity: 100 }], exactUnits: 4 }]]);
    const plan = planLevelling(TEST, books, 1, 10);
    assert.equal(plan.steps[0]?.materials[0]?.estimated, true);
    assert.equal(plan.shopping.find((m) => m.itemId === 1)?.estimated, true);
  });

  it("splits steps and totals at the skill tiers", () => {
    const long = recipe("Long", 1, 400, 500, [[1, 1]]);
    const profession: Profession = { ...TEST, recipes: [long] };
    const plan = planLevelling(profession, market({ 1: [[1, 10_000]] }), 1, MAX_SKILL);

    assert.deepEqual(
      plan.steps.map((s) => [s.from, s.to]),
      [
        [1, 150],
        [150, 225],
        [225, 300],
      ],
    );
    assert.deepEqual(
      plan.brackets.map((b) => [b.from, b.to, b.cost, b.complete]),
      [
        [1, 150, 149, true],
        [150, 225, 75, true],
        [225, 300, 75, true],
      ],
    );
    assert.deepEqual(
      plan.shopping.map((m) => [m.itemId, m.quantity, m.cost]),
      [[1, 299, 299]],
    );
  });
});

describe("loadMarket", () => {
  it("loads reagent order books and adds an estimated tail for unlisted depth", async () => {
    const db = openDb(":memory:");
    let auctionId = 1;
    const listing = (itemId: number, unitPrice: number, quantity: number): CommodityListing => ({
      id: auctionId++,
      item: { id: itemId },
      quantity,
      unit_price: unitPrice,
      time_left: "LONG",
    });
    // 25 distinct prices of Herb A: only the cheapest 20 levels are stored.
    const herbs = Array.from({ length: 25 }, (_, i) => listing(1, 10 + i, 2));
    const source: DataSource = {
      listHouses: async () => [],
      getItem: async () => null,
      fetchSnapshot: async () => ({ houseId: 113, takenAt: 1000, items: [], commodities: [...herbs, listing(777, 5, 5)] }),
    };
    await collectOnce({ db, source, rulesetId: 1, houseId: 113 });

    const { takenAt, market: loaded } = loadMarket(db, 113, TEST);

    assert.equal(takenAt, 1000);
    assert.equal(loaded.has(777), false); // not a reagent
    const herbA = loaded.get(1);
    assert.equal(herbA?.exactUnits, 40);
    assert.equal(herbA?.book.length, 21);
    assert.deepEqual(herbA?.book.at(-1), { unitPrice: 29, quantity: 10 });
  });

  it("copes with no snapshots", () => {
    const data = loadMarket(openDb(":memory:"), 113, TEST);
    assert.equal(data.takenAt, null);
    assert.equal(planLevelling(TEST, data.market, 1, 10).complete, false);
  });
});

for (const PROFESSION of [ALCHEMY, BLACKSMITHING]) {
describe(`the ${PROFESSION.id} recipes`, () => {
  it("offer a skill-up at every level from 1 to 299", () => {
    for (let skill = 1; skill < MAX_SKILL; skill++) {
      assert.ok(
        PROFESSION.recipes.some((r) => skillUpChance(r, skill) > 0),
        `no recipe gives a point at ${skill}`,
      );
    }
  });

  it("have sane thresholds and a name for every reagent", () => {
    assert.equal(new Set(PROFESSION.recipes.map((r) => r.spellId)).size, PROFESSION.recipes.length);
    for (const r of PROFESSION.recipes) {
      assert.ok(r.learn <= r.yellow && r.yellow <= r.grey, r.name);
      assert.ok(r.reagents.length > 0, r.name);
      for (const reagent of r.reagents) {
        assert.ok(PROFESSION.itemNames[reagent.itemId], `${r.name}: item ${reagent.itemId} has no name`);
      }
    }
  });

  it("can be planned from 1 to 300 when every reagent is on sale", () => {
    const everything: Market = new Map(
      Object.keys(PROFESSION.itemNames).map((id) => [Number(id), { book: [{ unitPrice: 100, quantity: 1_000_000 }], exactUnits: 1_000_000 }]),
    );
    const plan = planLevelling(PROFESSION, everything, 1, MAX_SKILL);
    assert.equal(plan.complete, true);
    assert.equal(plan.brackets.length, 3);
  });
});
}

describe("GET /api/levelling", () => {
  it("returns a plan and rejects a bad range", async () => {
    const { createApp } = await import("./api.js");
    const app = createApp({ db: openDb(":memory:"), defaultHouseId: 113 });
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address() as import("node:net").AddressInfo;
    try {
      const get = async (query: string) => {
        const response = await fetch(`http://127.0.0.1:${port}/api/levelling${query}`);
        return { status: response.status, body: (await response.json()) as any };
      };
      const empty = await get("");
      assert.equal(empty.status, 200);
      assert.deepEqual(empty.body.profession, { id: "alchemy", name: "Alchemy" });
      assert.deepEqual([empty.body.from, empty.body.to, empty.body.complete], [1, 300, false]);

      const smithing = await get("?profession=blacksmithing");
      assert.equal(smithing.body.profession.name, "Blacksmithing");
      assert.equal(smithing.body.professions.length, 2);

      assert.equal((await get("?from=200&to=150")).status, 400);
      assert.equal((await get("?profession=fishing")).status, 400);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
