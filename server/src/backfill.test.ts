import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { backfillItems } from "./backfill.js";
import type { DataSource } from "./dataSource.js";
import { openDb, type Db } from "./db.js";
import type { ItemInfo } from "./types.js";

const NOW = 1_800_000_000;
const DAY = 24 * 60 * 60;

// Knows the given items and records which IDs were asked for.
function fakeSource(known: ItemInfo[], failOn?: number) {
  const asked: number[] = [];
  const source: DataSource = {
    listHouses: async () => [],
    fetchSnapshot: async () => null,
    getItem: async (itemId) => {
      asked.push(itemId);
      if (itemId === failOn) throw new Error("Blizzard returned 503");
      return known.find((item) => item.id === itemId) ?? null;
    },
  };
  return { source, asked };
}

function queue(db: Db, itemId: number, firstSeen: number): void {
  db.prepare("INSERT INTO items (item_id, first_seen) VALUES (?, ?)").run(itemId, firstSeen);
}

function item(db: Db, itemId: number) {
  return db.prepare("SELECT name, quality, status, fetched_at FROM items WHERE item_id = ?").get(itemId);
}

const PEACEBLOOM: ItemInfo = { id: 2447, name: "Peacebloom", quality: "COMMON" };

describe("backfillItems", () => {
  it("stores the name of an item Blizzard knows", async () => {
    const db = openDb(":memory:");
    queue(db, 2447, 1000);

    const result = await backfillItems({ db, ...fakeSource([PEACEBLOOM]), now: () => NOW });

    assert.deepEqual(result, { found: 1, missing: 0, remaining: 0 });
    assert.deepEqual(item(db, 2447), { name: "Peacebloom", quality: "COMMON", status: "ok", fetched_at: NOW });
  });

  it("stores a name without a quality", async () => {
    const db = openDb(":memory:");
    queue(db, 5, 1000);

    await backfillItems({ db, ...fakeSource([{ id: 5, name: "Mystery" }]), now: () => NOW });

    assert.deepEqual(item(db, 5), { name: "Mystery", quality: null, status: "ok", fetched_at: NOW });
  });

  it("marks an item Blizzard has no data for as 'missing'", async () => {
    const db = openDb(":memory:");
    queue(db, 99999, 1000);

    const result = await backfillItems({ db, ...fakeSource([]), now: () => NOW });

    assert.deepEqual(result, { found: 0, missing: 1, remaining: 0 });
    assert.deepEqual(item(db, 99999), { name: null, quality: null, status: "missing", fetched_at: NOW });
  });

  it("looks up at most `limit` items, oldest sighting first", async () => {
    const db = openDb(":memory:");
    queue(db, 1, 3000);
    queue(db, 2, 1000);
    queue(db, 3, 2000);
    const fake = fakeSource([]);

    const result = await backfillItems({ db, source: fake.source, limit: 2, now: () => NOW });

    assert.deepEqual(fake.asked, [2, 3]);
    assert.equal(result.remaining, 1);
  });

  it("does not ask again for items it already has", async () => {
    const db = openDb(":memory:");
    queue(db, 2447, 1000);
    const fake = fakeSource([PEACEBLOOM]);

    await backfillItems({ db, source: fake.source, now: () => NOW });
    await backfillItems({ db, source: fake.source, now: () => NOW + 30 * DAY });

    assert.deepEqual(fake.asked, [2447]);
  });

  it("retries a missing item after a week, not before", async () => {
    const db = openDb(":memory:");
    queue(db, 2447, 1000);
    const nothingYet = fakeSource([]);
    await backfillItems({ db, source: nothingYet.source, now: () => NOW });

    // Six days later: too soon to retry.
    await backfillItems({ db, source: nothingYet.source, now: () => NOW + 6 * DAY });
    assert.deepEqual(nothingYet.asked, [2447]);

    // A week later Blizzard has added the item.
    const result = await backfillItems({ db, ...fakeSource([PEACEBLOOM]), now: () => NOW + 7 * DAY });
    assert.equal(result.found, 1);
    assert.deepEqual(item(db, 2447), {
      name: "Peacebloom",
      quality: "COMMON",
      status: "ok",
      fetched_at: NOW + 7 * DAY,
    });
  });

  it("stops at the first failed lookup and leaves the rest queued", async () => {
    const db = openDb(":memory:");
    queue(db, 2447, 1000);
    queue(db, 2, 2000);
    queue(db, 3, 3000);
    const fake = fakeSource([PEACEBLOOM], 2);

    const result = await backfillItems({ db, source: fake.source, now: () => NOW });

    assert.deepEqual(result, { found: 1, missing: 0, remaining: 2, error: "Blizzard returned 503" });
    assert.deepEqual(fake.asked, [2447, 2]); // item 3 was never tried
    assert.deepEqual(item(db, 2), { name: null, quality: null, status: "pending", fetched_at: null });
  });
});
