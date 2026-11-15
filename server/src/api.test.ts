// Each test gets a fresh in-memory database and a real server on a throwaway port.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { createApp } from "./api.js";
import { collectOnce } from "./collector.js";
import type { DataSource } from "./dataSource.js";
import { openDb, type Db } from "./db.js";
import type { CommodityListing } from "./types.js";

const HOUSE = 113;
const PEACEBLOOM = 2447;
const LINEN = 2589;
const UNNAMED = 99999;
const HOUR = 3600;
const T0 = 1_800_000_000; // first snapshot
const NOW = T0 + HOUR + 600; // ten minutes after the second snapshot

let auctionId = 1;
const listing = (itemId: number, unitPrice: number, quantity: number): CommodityListing => ({
  id: auctionId++,
  item: { id: itemId },
  quantity,
  unit_price: unitPrice,
  time_left: "LONG",
});

async function store(db: Db, takenAt: number, commodities: CommodityListing[]): Promise<void> {
  const source: DataSource = {
    listHouses: async () => [],
    fetchSnapshot: async () => ({ houseId: HOUSE, takenAt, commodities, items: [] }),
    getItem: async () => null,
  };
  const result = await collectOnce({ db, source, rulesetId: 1, houseId: HOUSE, now: () => takenAt + 300 });
  assert.equal(result.status, "ok");
}

// Two hourly snapshots. Linen Cloth is only in the first: it "sold out".
async function seededDb(): Promise<Db> {
  const db = openDb(":memory:");
  await store(db, T0, [listing(PEACEBLOOM, 40, 10), listing(LINEN, 50, 20), listing(UNNAMED, 7, 1)]);
  await store(db, T0 + HOUR, [listing(PEACEBLOOM, 36, 5), listing(PEACEBLOOM, 45, 20), listing(UNNAMED, 7, 1)]);
  const name = db.prepare("UPDATE items SET name = ?, quality = 'COMMON', status = 'ok' WHERE item_id = ?");
  name.run("Peacebloom", PEACEBLOOM);
  name.run("Linen Cloth", LINEN);
  return db;
}

async function withApi(db: Db, run: (get: (path: string) => Promise<{ status: number; body: any }>) => Promise<void>) {
  const app = createApp({ db, defaultHouseId: HOUSE, now: () => NOW });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(async (path) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      return { status: response.status, body: await response.json() };
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("GET /api/status", () => {
  it("reports the latest snapshot and that it is fresh", async () => {
    await withApi(await seededDb(), async (get) => {
      const { status, body } = await get("/api/status");
      assert.equal(status, 200);
      assert.deepEqual(body.lastSnapshot, {
        takenAt: T0 + HOUR,
        fetchedAt: T0 + HOUR + 300,
        listingCount: 3,
        ageSeconds: 600,
      });
      assert.equal(body.stale, false);
      assert.deepEqual(body.last24h, { ok: 2, empty: 0, failed: 0 });
      assert.deepEqual(body.items, { named: 2, pending: 1, missing: 0 });
      assert.equal(body.lastFailure, null);
    });
  });

  it("is stale when there is no snapshot at all", async () => {
    await withApi(openDb(":memory:"), async (get) => {
      const { body } = await get("/api/status");
      assert.equal(body.lastSnapshot, null);
      assert.equal(body.stale, true);
    });
  });

  it("is stale when the newest snapshot is over two hours old", async () => {
    const db = openDb(":memory:");
    await store(db, NOW - 3 * HOUR, [listing(PEACEBLOOM, 40, 1)]);
    await withApi(db, async (get) => {
      assert.equal((await get("/api/status")).body.stale, true);
    });
  });

  it("shows the most recent failure", async () => {
    const db = await seededDb();
    db.prepare(
      "INSERT INTO snapshots (ruleset_id, house_id, kind, fetched_at, status, error) VALUES (1, ?, 'commodities', ?, 'failed', 'Blizzard returned 503')",
    ).run(HOUSE, NOW - 60);
    await withApi(db, async (get) => {
      const { body } = await get("/api/status");
      assert.deepEqual(body.lastFailure, { fetchedAt: NOW - 60, error: "Blizzard returned 503" });
      assert.equal(body.last24h.failed, 1);
    });
  });
});

describe("GET /api/items", () => {
  it("lists every item with its current price, unnamed ones last", async () => {
    await withApi(await seededDb(), async (get) => {
      const { status, body } = await get("/api/items");
      assert.equal(status, 200);
      assert.equal(body.total, 3);
      assert.equal(body.takenAt, T0 + HOUR);
      assert.deepEqual(body.items, [
        // Not in the latest snapshot: still listed, no price.
        { id: LINEN, name: "Linen Cloth", quality: "COMMON", price: null },
        {
          id: PEACEBLOOM,
          name: "Peacebloom",
          quality: "COMMON",
          price: { minPrice: 36, medianPrice: 45, quantity: 25, qtyAtMin: 5, listingCount: 2 },
        },
        {
          id: UNNAMED,
          name: null,
          quality: null,
          price: { minPrice: 7, medianPrice: 7, quantity: 1, qtyAtMin: 1, listingCount: 1 },
        },
      ]);
    });
  });

  it("searches by part of the name, ignoring case", async () => {
    await withApi(await seededDb(), async (get) => {
      const { body } = await get("/api/items?q=PEACE");
      assert.deepEqual(body.items.map((i: any) => i.name), ["Peacebloom"]);
      assert.equal(body.total, 1);
    });
  });

  it("finds an item by its exact ID, even with no name", async () => {
    await withApi(await seededDb(), async (get) => {
      const { body } = await get(`/api/items?q=${UNNAMED}`);
      assert.deepEqual(body.items.map((i: any) => i.id), [UNNAMED]);
    });
  });

  it("treats % as a literal character, not a wildcard", async () => {
    await withApi(await seededDb(), async (get) => {
      assert.equal((await get("/api/items?q=%25")).body.total, 0); // %25 is an encoded %
    });
  });

  it("pages with limit and offset", async () => {
    await withApi(await seededDb(), async (get) => {
      const { body } = await get("/api/items?limit=1&offset=1");
      assert.deepEqual(body.items.map((i: any) => i.name), ["Peacebloom"]);
      assert.equal(body.total, 3); // total ignores paging
    });
  });

  it("rejects a bad limit with 400", async () => {
    await withApi(await seededDb(), async (get) => {
      const { status, body } = await get("/api/items?limit=abc");
      assert.equal(status, 400);
      assert.match(body.error, /limit/);
    });
  });

  it("returns items without prices for a house that has no snapshots", async () => {
    await withApi(await seededDb(), async (get) => {
      const { body } = await get("/api/items?house=110");
      assert.equal(body.takenAt, null);
      assert.ok(body.items.every((i: any) => i.price === null));
    });
  });
});

describe("GET /api/items/:id", () => {
  it("returns the item with its price levels, cheapest first", async () => {
    await withApi(await seededDb(), async (get) => {
      const { status, body } = await get(`/api/items/${PEACEBLOOM}`);
      assert.equal(status, 200);
      assert.deepEqual(body, {
        id: PEACEBLOOM,
        name: "Peacebloom",
        quality: "COMMON",
        nameStatus: "ok",
        house: HOUSE,
        takenAt: T0 + HOUR,
        price: { minPrice: 36, medianPrice: 45, quantity: 25, qtyAtMin: 5, listingCount: 2 },
        trend: null, // two snapshots: not enough history for a verdict
        levels: [
          { unitPrice: 36, quantity: 5 },
          { unitPrice: 45, quantity: 20 },
        ],
      });
    });
  });

  it("includes the trend verdict once there is enough history", async () => {
    const db = openDb(":memory:");
    for (let hoursAgo = 60; hoursAgo >= 1; hoursAgo--) {
      await store(db, NOW - hoursAgo * HOUR, [listing(PEACEBLOOM, 100, 10)]);
    }
    await store(db, NOW, [listing(PEACEBLOOM, 60, 25)]);

    await withApi(db, async (get) => {
      const { body } = await get(`/api/items/${PEACEBLOOM}`);
      assert.deepEqual(body.trend, {
        recentMedian: 100,
        weekMedian: 100,
        trendRatio: 1,
        trend: "stable",
        expectedSale: 95,
        profitPerUnit: 35,
        isDeal: true,
        snapshots: 61,
      });
    });
  });

  it("returns a known item that is not listed right now, without a price", async () => {
    await withApi(await seededDb(), async (get) => {
      const { status, body } = await get(`/api/items/${LINEN}`);
      assert.equal(status, 200);
      assert.equal(body.price, null);
      assert.deepEqual(body.levels, []);
    });
  });

  it("returns 404 for an item never seen", async () => {
    await withApi(await seededDb(), async (get) => {
      const { status, body } = await get("/api/items/123456");
      assert.equal(status, 404);
      assert.match(body.error, /123456/);
    });
  });

  it("returns 400 for an ID that is not a number", async () => {
    await withApi(await seededDb(), async (get) => {
      assert.equal((await get("/api/items/peacebloom")).status, 400);
    });
  });
});

describe("GET /api/items/:id/history", () => {
  it("returns one point per snapshot, oldest first", async () => {
    await withApi(await seededDb(), async (get) => {
      const { status, body } = await get(`/api/items/${PEACEBLOOM}/history`);
      assert.equal(status, 200);
      assert.equal(body.days, 7);
      assert.deepEqual(body.points, [
        { takenAt: T0, minPrice: 40, medianPrice: 40, quantity: 10, qtyAtMin: 10, listingCount: 1 },
        { takenAt: T0 + HOUR, minPrice: 36, medianPrice: 45, quantity: 25, qtyAtMin: 5, listingCount: 2 },
      ]);
    });
  });

  it("leaves a gap where the item was not listed", async () => {
    await withApi(await seededDb(), async (get) => {
      const { body } = await get(`/api/items/${LINEN}/history`);
      assert.deepEqual(body.points.map((p: any) => p.takenAt), [T0]);
    });
  });

  it("only goes back as many days as asked", async () => {
    // Oldest first: the collector only accepts newer snapshots.
    const db = openDb(":memory:");
    await store(db, NOW - 3 * 24 * HOUR, [listing(PEACEBLOOM, 99, 1)]);
    await store(db, NOW - HOUR, [listing(PEACEBLOOM, 36, 1)]);
    await withApi(db, async (get) => {
      const week = await get(`/api/items/${PEACEBLOOM}/history?days=7`);
      const day = await get(`/api/items/${PEACEBLOOM}/history?days=1`);
      assert.deepEqual(week.body.points.map((p: any) => p.minPrice), [99, 36]);
      assert.deepEqual(day.body.points.map((p: any) => p.minPrice), [36]);
    });
  });

  it("returns 404 for an item never seen, and 400 for silly input", async () => {
    await withApi(await seededDb(), async (get) => {
      assert.equal((await get("/api/items/123456/history")).status, 404);
      assert.equal((await get(`/api/items/${PEACEBLOOM}/history?days=0`)).status, 400);
    });
  });
});

describe("unknown API paths", () => {
  it("answer with a JSON 404", async () => {
    await withApi(await seededDb(), async (get) => {
      const { status, body } = await get("/api/nope");
      assert.equal(status, 404);
      assert.deepEqual(body, { error: "No such endpoint" });
    });
  });
});

describe("GET /api/deals", () => {
  it("explains an empty list while history is still being collected", async () => {
    await withApi(await seededDb(), async (get) => {
      const { status, body } = await get("/api/deals");
      assert.equal(status, 200);
      assert.deepEqual(body.history, { snapshots: 2, needed: 48, ready: false, itemsJudged: 0 });
      assert.deepEqual(body.deals, []);
    });
  });

  it("returns a deal once there is enough history", async () => {
    // 60 hourly snapshots of Peacebloom at 100c, then one at 60c.
    const db = openDb(":memory:");
    for (let hoursAgo = 60; hoursAgo >= 1; hoursAgo--) {
      await store(db, NOW - hoursAgo * HOUR, [listing(PEACEBLOOM, 100, 10)]);
    }
    await store(db, NOW, [listing(PEACEBLOOM, 60, 25), listing(PEACEBLOOM, 100, 10)]);

    await withApi(db, async (get) => {
      const { body } = await get("/api/deals?maxQty=20");
      assert.equal(body.history.ready, true);
      assert.equal(body.minProfit, 1); // the default from the settings table
      assert.equal(body.deals.length, 1);
      const deal = body.deals[0];
      assert.equal(deal.id, PEACEBLOOM);
      assert.equal(deal.minPrice, 60);
      assert.equal(deal.profitPerUnit, 35); // 100 - 5% cut = 95, minus 60
      assert.equal(deal.qtyAtMin, 25);
      assert.equal(deal.buyQty, 20); // capped by maxQty
      assert.equal(deal.totalProfit, 700);

      assert.deepEqual((await get("/api/deals?minProfit=36")).body.deals, []);
    });
  });
});

describe("GET /api/settings", () => {
  it("returns the numbers the deals rule uses", async () => {
    await withApi(await seededDb(), async (get) => {
      const { status, body } = await get("/api/settings");
      assert.equal(status, 200);
      assert.equal(body.ahCut, 0.05);
      assert.equal(body.dealMinSnapshots, 48);
    });
  });
});
