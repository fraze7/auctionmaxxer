import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectOnce } from "./collector.js";
import type { DataSource } from "./dataSource.js";
import { migrate, openDb, type Db } from "./db.js";
import { MockSource } from "./mockSource.js";
import type { CommodityListing, Snapshot } from "./types.js";

const RULESET = 1;
const HOUSE = 113;
const PEACEBLOOM = 2447;
const FETCHED_AT = 1_800_000_000; // a fixed "now", so tests don't depend on the clock

function count(db: Db, table: string): number {
  const row = db.prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).get();
  return row?.n ?? 0;
}

function collect(db: Db, source: DataSource) {
  return collectOnce({ db, source, rulesetId: RULESET, houseId: HOUSE, now: () => FETCHED_AT });
}

// Returns whatever the test hands it, or throws.
function fakeSource(next: () => Snapshot | null): DataSource {
  return {
    listHouses: async () => [{ id: HOUSE, name: "Test house" }],
    fetchSnapshot: async () => next(),
    getItem: async () => null,
  };
}

function snapshotAt(takenAt: number, commodities: CommodityListing[]): Snapshot {
  return { houseId: HOUSE, takenAt, commodities, items: [] };
}

const onePeacebloom: CommodityListing[] = [
  { id: 1, item: { id: PEACEBLOOM }, quantity: 5, unit_price: 36, time_left: "LONG" },
];

describe("migrate", () => {
  it("applies each migration only once", () => {
    const db = openDb(":memory:"); // openDb already ran the migrations
    assert.deepEqual(migrate(db), []);
    assert.ok(count(db, "schema_migrations") >= 1);
  });
});

describe("collectOnce", () => {
  it("stores the mock snapshot", async () => {
    const db = openDb(":memory:");
    const result = await collect(db, new MockSource());

    assert.equal(result.status, "ok");
    assert.equal(count(db, "snapshots"), 1);

    const snapshot = db.prepare("SELECT * FROM snapshots").get();
    assert.deepEqual(snapshot, {
      id: 1,
      ruleset_id: RULESET,
      house_id: HOUSE,
      kind: "commodities",
      taken_at: Date.parse("2026-11-09T16:12:19Z") / 1000,
      fetched_at: FETCHED_AT,
      status: "ok",
      listing_count: 914,
      error: null,
    });

    const peacebloom = db
      .prepare("SELECT min_price, quantity, listing_count FROM commodity_prices WHERE item_id = ?")
      .get(PEACEBLOOM);
    assert.deepEqual(peacebloom, { min_price: 36, quantity: 3581, listing_count: 188 });

    // Level 0 is the cheapest price and holds exactly qty_at_min units.
    const cheapest = db
      .prepare(`
        SELECT l.unit_price, l.quantity, p.qty_at_min
        FROM price_levels l JOIN commodity_prices p USING (snapshot_id, item_id)
        WHERE l.item_id = ? AND l.level = 0
      `)
      .get(PEACEBLOOM) as { unit_price: number; quantity: number; qty_at_min: number };
    assert.equal(cheapest.unit_price, 36);
    assert.equal(cheapest.quantity, cheapest.qty_at_min);

    // Every item seen is queued for a name lookup.
    assert.equal(count(db, "items"), count(db, "commodity_prices") + count(db, "item_prices"));

    // One-at-a-time listings get a price per item and are queued as 'single'.
    assert.ok(count(db, "item_prices") > 0);
    const single = db
      .prepare<[], { kind: string; min_buyout: number; median_buyout: number; listing_count: number }>(`
        SELECT i.kind, p.min_buyout, p.median_buyout, p.listing_count
        FROM item_prices p JOIN items i USING (item_id)
        ORDER BY p.listing_count DESC LIMIT 1
      `)
      .get()!;
    assert.equal(single.kind, "single");
    assert.ok(single.min_buyout > 0 && single.median_buyout >= single.min_buyout && single.listing_count >= 1);
    const pending = db.prepare("SELECT status, name FROM items WHERE item_id = ?").get(PEACEBLOOM);
    assert.deepEqual(pending, { status: "pending", name: null });
  });

  it("still stores the commodities when single items cannot be stored", async () => {
    const db = openDb(":memory:");
    db.exec("DROP TABLE item_prices");
    const result = await collect(db, new MockSource());

    assert.equal(result.status, "ok");
    assert.ok(result.status === "ok" && result.singlesError?.includes("item_prices"));
    assert.ok(count(db, "commodity_prices") > 0);
    assert.equal(count(db, "items"), count(db, "commodity_prices"));
  });

  it("skips a snapshot it already has", async () => {
    const db = openDb(":memory:");
    const source = new MockSource();
    await collect(db, source);
    const pricesBefore = count(db, "commodity_prices");

    const second = await collect(db, source);
    assert.equal(second.status, "skipped");
    assert.equal(count(db, "snapshots"), 1);
    assert.equal(count(db, "commodity_prices"), pricesBefore);
  });

  it("skips when the source hands back an old snapshot anyway", async () => {
    const db = openDb(":memory:");
    const source = fakeSource(() => snapshotAt(1000, onePeacebloom));
    await collect(db, source);

    assert.equal((await collect(db, source)).status, "skipped");
    assert.equal(count(db, "snapshots"), 1);
  });

  it("stores a newer snapshot next to the old one, without re-queuing items", async () => {
    const db = openDb(":memory:");
    await collect(db, fakeSource(() => snapshotAt(1000, onePeacebloom)));
    const result = await collect(db, fakeSource(() => snapshotAt(4600, onePeacebloom)));

    assert.equal(result.status, "ok");
    assert.equal(count(db, "snapshots"), 2);
    assert.equal(count(db, "commodity_prices"), 2);
    assert.equal(count(db, "items"), 1);
    const item = db.prepare("SELECT first_seen FROM items").get();
    assert.deepEqual(item, { first_seen: 1000 }); // still the first sighting
  });

  it("records an empty house as 'empty', not as a failure", async () => {
    const db = openDb(":memory:");
    const result = await collect(db, fakeSource(() => snapshotAt(1000, [])));

    assert.equal(result.status, "empty");
    const row = db.prepare("SELECT status, listing_count, error FROM snapshots").get();
    assert.deepEqual(row, { status: "empty", listing_count: 0, error: null });
    assert.equal(count(db, "commodity_prices"), 0);
  });

  it("records a failed fetch and carries on next time", async () => {
    const db = openDb(":memory:");
    const broken = fakeSource(() => {
      throw new Error("Blizzard returned 503");
    });

    const first = await collect(db, broken);
    assert.equal(first.status, "failed");
    await collect(db, broken); // a second failure must not collide with the first

    const rows = db.prepare("SELECT status, taken_at, error FROM snapshots").all();
    assert.deepEqual(rows, [
      { status: "failed", taken_at: null, error: "Blizzard returned 503" },
      { status: "failed", taken_at: null, error: "Blizzard returned 503" },
    ]);

    // A failure doesn't count as "already have it".
    const recovered = await collect(db, new MockSource());
    assert.equal(recovered.status, "ok");
    assert.equal(count(db, "snapshots"), 3);
  });

  it("writes nothing from a snapshot that fails halfway through", async () => {
    const db = openDb(":memory:");
    // The second listing breaks a database rule after the first was inserted.
    const result = await collect(
      db,
      fakeSource(() =>
        snapshotAt(1000, [
          ...onePeacebloom,
          { id: 2, item: { id: 2589 }, quantity: 1, unit_price: 12.5, time_left: "LONG" },
        ]),
      ),
    );

    assert.equal(result.status, "failed");
    assert.equal(count(db, "commodity_prices"), 0); // Peacebloom was rolled back
    assert.equal(count(db, "price_levels"), 0);
    assert.equal(count(db, "items"), 0);
    const row = db.prepare<[], { status: string }>("SELECT status FROM snapshots").all();
    assert.deepEqual(row, [{ status: "failed" }]);
  });
});
