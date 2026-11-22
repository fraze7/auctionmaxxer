import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectOnce } from "./collector.js";
import type { DataSource } from "./dataSource.js";
import { openDb } from "./db.js";
import { groupHours, hourlyPattern } from "./hours.js";

const HOUR = 3600;

// One snapshot an hour from midnight UTC, item 1 priced by `priceAt(hour of day, day)`.
async function dbWith(hours: number, priceAt: (hour: number, day: number) => number) {
  const db = openDb(":memory:");
  for (let index = 0; index < hours; index++) {
    const source: DataSource = {
      listHouses: async () => [],
      getItem: async () => null,
      fetchSnapshot: async () => ({
        houseId: 113,
        takenAt: 1000 * 24 * HOUR + index * HOUR,
        items: [],
        commodities: [
          {
            id: index + 1,
            item: { id: 1 },
            quantity: 10,
            unit_price: priceAt(index % 24, Math.floor(index / 24)),
            time_left: "LONG",
          },
        ],
      }),
    };
    await collectOnce({ db, source, rulesetId: 1, houseId: 113 });
  }
  return db;
}

describe("hourlyPattern", () => {
  it("finds the cheap and dear hours of the day", async () => {
    const db = await dbWith(8 * 24, (hour) => (hour === 4 ? 80 : hour === 20 ? 120 : 100));
    const pattern = hourlyPattern(db, 113, 1);

    assert.equal(pattern.ready, true);
    assert.equal(pattern.repeats, true);
    assert.equal(pattern.hours.length, 24);
    assert.equal(pattern.hours[4]?.ratio, 0.8);
    assert.equal(pattern.hours[20]?.ratio, 1.2);
    assert.equal(pattern.hours[12]?.ratio, 1);
  });

  it("is not thrown by a price that rises all week", async () => {
    // Doubling each day would make every late hour look dear without the daily baseline.
    const db = await dbWith(8 * 24, (hour, day) => (hour === 4 ? 80 : 100) * (day + 1));
    const pattern = hourlyPattern(db, 113, 1);

    assert.equal(pattern.hours[4]?.ratio, 0.8);
    assert.equal(pattern.hours[12]?.ratio, 1);
  });

  it("does not call it a pattern when odd and even days disagree", async () => {
    const db = await dbWith(8 * 24, (hour, day) => (hour === (day % 2 ? 4 : 16) ? 80 : 100));
    const pattern = hourlyPattern(db, 113, 1);
    assert.deepEqual([pattern.ready, pattern.repeats], [true, false]);
  });

  it("does not call a steady price a pattern", async () => {
    const pattern = hourlyPattern(await dbWith(8 * 24, () => 100), 113, 1);
    assert.deepEqual([pattern.ready, pattern.repeats], [true, false]);
  });

  it("gives no figures until each hour has been seen on enough days", async () => {
    const pattern = hourlyPattern(await dbWith(3 * 24, () => 100), 113, 1);

    assert.equal(pattern.ready, false);
    assert.ok(pattern.hours.every((entry) => entry.ratio === null));
    assert.ok(pattern.days > 2.9 && pattern.days < 3);
  });

  it("copes with an item that was never listed", async () => {
    const pattern = hourlyPattern(await dbWith(24, () => 100), 113, 99);
    assert.deepEqual([pattern.days, pattern.ready, pattern.repeats], [0, false, false]);
  });
});

describe("groupHours", () => {
  it("names the cheapest and dearest four hours", async () => {
    const db = await dbWith(8 * 24, (hour) => (hour >= 20 ? 80 : hour >= 10 && hour < 14 ? 120 : 100));
    assert.deepEqual(groupHours(db, 113, [1]), {
      cheapest: { from: 20, to: 0, ratio: 0.8 },
      dearest: { from: 10, to: 14, ratio: 1.2 },
    });
  });

  it("names nothing for a steady price", async () => {
    const db = await dbWith(8 * 24, () => 100);
    assert.deepEqual(groupHours(db, 113, [1]), { cheapest: null, dearest: null });
  });

  it("names nothing when odd and even days disagree", async () => {
    const db = await dbWith(8 * 24, (hour, day) => ((day % 2 ? hour >= 20 : hour >= 8 && hour < 12) ? 80 : 100));
    assert.equal(groupHours(db, 113, [1]).cheapest, null);
  });

  it("copes with items never listed", async () => {
    const db = await dbWith(8 * 24, () => 100);
    assert.deepEqual(groupHours(db, 113, [999]), { cheapest: null, dearest: null });
  });
});
