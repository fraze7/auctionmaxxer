import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectOnce } from "./collector.js";
import type { DataSource } from "./dataSource.js";
import { openDb } from "./db.js";
import { planPrices } from "./plans.js";

// Snapshots of one-at-a-time listings, each as [itemId, buyout]; item 1 is a commodity.
async function dbWith(...snapshots: Array<Array<[number, number]>>) {
  const db = openDb(":memory:");
  let id = 1;
  for (const [index, listings] of snapshots.entries()) {
    const source: DataSource = {
      listHouses: async () => [],
      getItem: async () => null,
      fetchSnapshot: async () => ({
        houseId: 113,
        takenAt: 1000 + index * 3600,
        commodities: [{ id: id++, item: { id: 1 }, quantity: 5, unit_price: 10, time_left: "LONG" }],
        items: listings.map(([itemId, buyout]) => ({
          id: id++,
          item: { id: itemId },
          quantity: 1,
          buyout,
          time_left: "LONG" as const,
        })),
      }),
    };
    await collectOnce({ db, source, rulesetId: 1, houseId: 113 });
  }
  const name = db.prepare("UPDATE items SET name = ?, status = 'ok' WHERE item_id = ?");
  name.run("Plans: Radiant Boots", 50);
  name.run("Formula: Enchant Bracer - Greater Stamina", 60);
  return db;
}

describe("planPrices", () => {
  it("finds a recipe's plan by name and gives its cheapest buyout now", async () => {
    const db = await dbWith([
      [50, 90_000],
      [50, 70_000],
      [60, 5_000],
    ]);
    const prices = planPrices(db, 113, ["Radiant Boots", "Enchant Bracer - Greater Stamina", "Copper Bracers"]);

    assert.deepEqual(prices.get("Radiant Boots"), { itemId: 50, price: 70_000, listed: 2, seen: true });
    assert.deepEqual(prices.get("Enchant Bracer - Greater Stamina"), {
      itemId: 60,
      price: 5_000,
      listed: 1,
      seen: true,
    });
    // No such plan has ever been listed.
    assert.equal(prices.has("Copper Bracers"), false);
  });

  it("says when a known plan is not listed right now", async () => {
    const db = await dbWith([[50, 90_000]], []);
    assert.deepEqual(planPrices(db, 113, ["Radiant Boots"]).get("Radiant Boots"), {
      itemId: 50,
      price: null,
      listed: 0,
      seen: true,
    });
  });

  it("knows a few plans by item ID, and whether they have ever been listed", async () => {
    const never = planPrices(await dbWith([[50, 90_000]]), 113, ["Imperial Plate Gauntlets"]);
    assert.deepEqual(never.get("Imperial Plate Gauntlets"), { itemId: 251441, price: null, listed: 0, seen: false });

    const listed = planPrices(await dbWith([[251441, 40_000]]), 113, ["Imperial Plate Gauntlets"]);
    assert.deepEqual(listed.get("Imperial Plate Gauntlets"), { itemId: 251441, price: 40_000, listed: 1, seen: true });
  });
});
