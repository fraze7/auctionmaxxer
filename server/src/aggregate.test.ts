import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarizeCommodities } from "./aggregate.js";
import { MockSource } from "./mockSource.js";
import type { CommodityListing } from "./types.js";

const PEACEBLOOM = 2447;
const LINEN = 2589;

let nextAuctionId = 1;
function listing(itemId: number, unitPrice: number, quantity: number): CommodityListing {
  return {
    id: nextAuctionId++,
    item: { id: itemId },
    quantity,
    unit_price: unitPrice,
    time_left: "LONG",
  };
}

describe("summarizeCommodities", () => {
  it("returns nothing for an empty house", () => {
    assert.deepEqual(summarizeCommodities([]), []);
  });

  it("summarises a single listing", () => {
    const [summary] = summarizeCommodities([listing(PEACEBLOOM, 40, 5)]);
    assert.deepEqual(summary, {
      itemId: PEACEBLOOM,
      minPrice: 40,
      medianPrice: 40,
      quantity: 5,
      qtyAtMin: 5,
      listingCount: 1,
      levels: [{ unitPrice: 40, quantity: 5 }],
    });
  });

  it("computes min, quantity, qtyAtMin and listing count", () => {
    const [summary] = summarizeCommodities([
      listing(PEACEBLOOM, 50, 10),
      listing(PEACEBLOOM, 36, 3), // cheapest price, listed twice
      listing(PEACEBLOOM, 36, 4),
      listing(PEACEBLOOM, 45, 20),
    ]);
    assert.equal(summary?.minPrice, 36);
    assert.equal(summary?.quantity, 37);
    assert.equal(summary?.qtyAtMin, 7); // 3 + 4, across both listings at 36c
    assert.equal(summary?.listingCount, 4);
  });

  it("weights the median by quantity, not by listing", () => {
    // Counting listings the median would be 10c; counting units it's 100c.
    const [summary] = summarizeCommodities([
      listing(PEACEBLOOM, 10, 1),
      listing(PEACEBLOOM, 10, 1),
      listing(PEACEBLOOM, 100, 100),
    ]);
    assert.equal(summary?.medianPrice, 100);
  });

  it("takes the cheaper middle unit when the unit count is even", () => {
    // Units in a row: 10, 10, 20, 20. The middle two are 10 and 20 -> 10.
    const [summary] = summarizeCommodities([
      listing(PEACEBLOOM, 10, 2),
      listing(PEACEBLOOM, 20, 2),
    ]);
    assert.equal(summary?.medianPrice, 10);
  });

  it("is not thrown off by a troll-priced listing", () => {
    // A mean would land near 100g; the median must stay at the normal price.
    const troll = 999_999 * 10_000;
    const [summary] = summarizeCommodities([
      listing(PEACEBLOOM, 38, 40),
      listing(PEACEBLOOM, 40, 40),
      listing(PEACEBLOOM, 42, 20),
      listing(PEACEBLOOM, troll, 1),
    ]);
    assert.equal(summary?.medianPrice, 40);
    assert.equal(summary?.minPrice, 38);
    assert.equal(summary?.quantity, 101); // the troll unit is still counted as listed
  });

  it("keeps items separate and sorts them by item ID", () => {
    const summaries = summarizeCommodities([
      listing(LINEN, 50, 20),
      listing(PEACEBLOOM, 36, 5),
      listing(LINEN, 60, 20),
    ]);
    assert.deepEqual(
      summaries.map((s) => [s.itemId, s.minPrice, s.quantity]),
      [
        [PEACEBLOOM, 36, 5],
        [LINEN, 50, 40],
      ],
    );
  });

  it("merges same-price listings into one level, cheapest first", () => {
    const [summary] = summarizeCommodities([
      listing(PEACEBLOOM, 45, 20),
      listing(PEACEBLOOM, 36, 3),
      listing(PEACEBLOOM, 50, 10),
      listing(PEACEBLOOM, 36, 4),
    ]);
    assert.deepEqual(summary?.levels, [
      { unitPrice: 36, quantity: 7 },
      { unitPrice: 45, quantity: 20 },
      { unitPrice: 50, quantity: 10 },
    ]);
  });

  it("keeps only the cheapest maxLevels levels, but counts everything in the totals", () => {
    const [summary] = summarizeCommodities(
      [
        listing(PEACEBLOOM, 10, 1),
        listing(PEACEBLOOM, 20, 1),
        listing(PEACEBLOOM, 30, 1),
        listing(PEACEBLOOM, 40, 1),
      ],
      2,
    );
    assert.deepEqual(summary?.levels, [
      { unitPrice: 10, quantity: 1 },
      { unitPrice: 20, quantity: 1 },
    ]);
    assert.equal(summary?.quantity, 4);
    assert.equal(summary?.listingCount, 4);
  });

  it("ignores listings priced at 0 copper", () => {
    const summaries = summarizeCommodities([
      listing(PEACEBLOOM, 0, 50),
      listing(PEACEBLOOM, 36, 5),
      listing(LINEN, 0, 10), // an item with only bad listings disappears entirely
    ]);
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0]?.minPrice, 36);
    assert.equal(summaries[0]?.quantity, 5);
  });
});

// Figures checked against the game on 9 Nov 2026.
describe("summarizeCommodities on the saved fixture", () => {
  it("matches the known Peacebloom figures", async () => {
    const snapshot = await new MockSource().fetchSnapshot(113);
    assert.ok(snapshot);

    const summaries = summarizeCommodities(snapshot.commodities);
    const peacebloom = summaries.find((s) => s.itemId === PEACEBLOOM);
    assert.equal(peacebloom?.minPrice, 36);
    assert.equal(peacebloom?.quantity, 3581);
    assert.equal(peacebloom?.listingCount, 188);

    // The database's CHECK constraints must hold for every item.
    for (const s of summaries) {
      assert.ok(s.minPrice > 0 && s.medianPrice >= s.minPrice, `prices for item ${s.itemId}`);
      assert.ok(s.qtyAtMin >= 1 && s.qtyAtMin <= s.quantity, `quantities for item ${s.itemId}`);
    }
  });
});
