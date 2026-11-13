import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openDb, type Db } from "./db.js";
import { evaluateItem, findDeals, median } from "./deals.js";
import { loadSettings, type Settings } from "./settings.js";

const GOLD = 10_000;
const HOUR = 3600;
const NOW = 1_800_000_000;

const settings: Settings = {
  ahCut: 0.05,
  dealMinSnapshots: 48,
  dealTrendFalling: 0.85,
  dealTrendRising: 1.15,
  dealMaxPriceRatio: 0.8,
  dealMinProfit: 1,
};

// A flat stretch of hourly history.
const flat = (price: number, count: number): number[] => Array<number>(count).fill(price);

describe("median", () => {
  it("takes the middle value, whatever the order", () => {
    assert.equal(median([30, 10, 20]), 20);
  });
  it("averages the two middle values and rounds down", () => {
    assert.equal(median([10, 21]), 15);
  });
  it("ignores a troll outlier", () => {
    assert.equal(median([40, 41, 42, 999_999 * GOLD]), 41);
  });
});

describe("evaluateItem", () => {
  it("gives no verdict without enough history", () => {
    assert.equal(evaluateItem(70, flat(100, 47), flat(100, 24), settings), null);
  });

  it("flags a deal: stable market, current price 30% under the median", () => {
    const result = evaluateItem(70, flat(100, 168), flat(100, 24), settings);
    assert.deepEqual(result, {
      recentMedian: 100,
      weekMedian: 100,
      trendRatio: 1,
      trend: "stable",
      expectedSale: 95, // 100 minus the 5% cut
      profitPerUnit: 25, // 95 - 70
      isDeal: true,
    });
  });

  it("is not a deal when the price is only slightly under the median", () => {
    // 85 is more than 80% of 100, even though selling at 95 would profit.
    const result = evaluateItem(85, flat(100, 168), flat(100, 24), settings);
    assert.equal(result?.isDeal, false);
    assert.equal(result?.profitPerUnit, 10);
  });

  it("matches the build plan's example: looks 40% off, but the market is falling", () => {
    // Week median 50g, last-24h median 35g, current min 30g.
    const week = [...flat(50 * GOLD, 144), ...flat(35 * GOLD, 24)];
    const result = evaluateItem(30 * GOLD, week, flat(35 * GOLD, 24), settings);
    assert.equal(result?.weekMedian, 50 * GOLD);
    assert.equal(result?.recentMedian, 35 * GOLD);
    assert.equal(result?.trendRatio, 0.7);
    assert.equal(result?.trend, "falling");
    assert.equal(result?.isDeal, false);
  });

  it("uses the lower median for the sale price when the market is rising", () => {
    // Week 100, last day 130: rising. Selling is assumed at 100, not 130.
    const week = [...flat(100, 144), ...flat(130, 24)];
    const result = evaluateItem(70, week, flat(130, 24), settings);
    assert.equal(result?.trend, "rising");
    assert.equal(result?.expectedSale, 95);
    assert.equal(result?.isDeal, true);
  });

  it("rounds the sale price down to whole copper", () => {
    const result = evaluateItem(1, flat(55, 168), flat(55, 24), settings);
    assert.equal(result?.expectedSale, 52); // 55 x 0.95 = 52.25
  });
});

// --- findDeals against a database ---

const HOUSE = 113;
const CHEAP_NOW = 1; // flat at 100c, then 60c in the latest snapshot -> a deal
const STEADY = 2; // flat at 100c throughout -> nothing to see
const FALLING = 3; // 100c for most of the week, 60c for the last day -> falling
const BIG_STACK = 4; // like CHEAP_NOW but 1,000 units at the low price
const NEWCOMER = 5; // only appears in the last 10 snapshots -> not enough history

function priceAt(itemId: number, hoursAgo: number): number | null {
  switch (itemId) {
    case CHEAP_NOW:
    case BIG_STACK:
      return hoursAgo === 0 ? 60 : 100;
    case STEADY:
      return 100;
    case FALLING:
      return hoursAgo < 24 ? 60 : 100;
    case NEWCOMER:
      return hoursAgo < 10 ? 50 : null;
    default:
      return null;
  }
}

// `hours` hourly snapshots ending at NOW.
function seed(hours: number): Db {
  const db = openDb(":memory:");
  const snapshot = db.prepare(
    "INSERT INTO snapshots (ruleset_id, house_id, kind, taken_at, fetched_at, status, listing_count) VALUES (1, ?, 'commodities', ?, ?, 'ok', 5)",
  );
  const price = db.prepare("INSERT INTO commodity_prices VALUES (?, ?, ?, ?, ?, ?, 1)");
  db.prepare(
    "INSERT INTO items (item_id, name, quality, status, first_seen) VALUES (1, 'Cheap Now', 'COMMON', 'ok', 0), (4, 'Big Stack', 'COMMON', 'ok', 0)",
  ).run();

  db.transaction(() => {
    for (let hoursAgo = hours - 1; hoursAgo >= 0; hoursAgo--) {
      const takenAt = NOW - hoursAgo * HOUR;
      const id = Number(snapshot.run(HOUSE, takenAt, takenAt).lastInsertRowid);
      for (const itemId of [CHEAP_NOW, STEADY, FALLING, BIG_STACK, NEWCOMER]) {
        const min = priceAt(itemId, hoursAgo);
        if (min === null) continue;
        const qty = itemId === BIG_STACK ? 1000 : 10;
        price.run(id, itemId, min, min, qty, qty);
      }
    }
  })();
  return db;
}

const find = (db: Db, extra: Partial<Parameters<typeof findDeals>[0]> = {}) =>
  findDeals({ db, houseId: HOUSE, settings, show: "deals", minProfit: 1, limit: 100, ...extra });

describe("findDeals", () => {
  it("returns nothing, but says why, when there is too little history", () => {
    const result = find(seed(12));
    assert.deepEqual(result, { takenAt: NOW, snapshotsInWindow: 12, itemsJudged: 0, deals: [] });
  });

  it("handles a house with no snapshots at all", () => {
    const result = find(openDb(":memory:"));
    assert.deepEqual(result, { takenAt: null, snapshotsInWindow: 0, itemsJudged: 0, deals: [] });
  });

  it("finds the deals and ranks them by total profit", () => {
    const result = find(seed(168));

    assert.equal(result.snapshotsInWindow, 168);
    assert.equal(result.itemsJudged, 4); // everything except the newcomer
    assert.deepEqual(
      result.deals.map((d) => [d.id, d.name, d.profitPerUnit, d.buyQty, d.totalProfit]),
      [
        // Same profit per unit, far more units.
        [BIG_STACK, "Big Stack", 35, 1000, 35_000],
        [CHEAP_NOW, "Cheap Now", 35, 10, 350],
      ],
    );
    assert.equal(result.deals[0]?.trend, "stable");
    assert.equal(result.deals[0]?.snapshots, 168);
  });

  it("caps the quantity at what you would actually buy", () => {
    const result = find(seed(168), { maxQty: 50 });
    assert.deepEqual(
      result.deals.map((d) => [d.id, d.buyQty, d.totalProfit]),
      [
        [BIG_STACK, 50, 1750],
        [CHEAP_NOW, 10, 350],
      ],
    );
  });

  it("drops deals below the minimum profit per unit", () => {
    assert.equal(find(seed(168), { minProfit: 35 }).deals.length, 2);
    assert.equal(find(seed(168), { minProfit: 36 }).deals.length, 0);
  });

  it("lists falling markets separately, never as deals", () => {
    const db = seed(168);
    assert.ok(!find(db).deals.some((d) => d.id === FALLING));

    const falling = find(db, { show: "falling" });
    assert.deepEqual(falling.deals.map((d) => d.id), [FALLING]);
    assert.equal(falling.deals[0]?.trendRatio, 0.6);
  });

  it("only looks at the last 7 days", () => {
    // The window still holds only 168 snapshots.
    assert.equal(find(seed(400)).snapshotsInWindow, 168);
  });

  it("respects the limit", () => {
    assert.deepEqual(find(seed(168), { limit: 1 }).deals.map((d) => d.id), [BIG_STACK]);
  });
});

describe("loadSettings", () => {
  it("reads the defaults the migration seeds", () => {
    assert.deepEqual(loadSettings(openDb(":memory:")), settings);
  });

  it("picks up an edited value", () => {
    const db = openDb(":memory:");
    db.prepare("UPDATE settings SET value = '0.1' WHERE key = 'ah_cut'").run();
    assert.equal(loadSettings(db).ahCut, 0.1);
  });

  it("falls back to the default for a deleted key", () => {
    const db = openDb(":memory:");
    db.prepare("DELETE FROM settings WHERE key = 'deal_min_snapshots'").run();
    assert.equal(loadSettings(db).dealMinSnapshots, 48);
  });

  it("refuses a nonsense value instead of computing wrong deals", () => {
    const db = openDb(":memory:");
    db.prepare("UPDATE settings SET value = '5' WHERE key = 'ah_cut'").run(); // 5 = 500%, meant 0.05
    assert.throws(() => loadSettings(db), /ah_cut/);
  });
});
