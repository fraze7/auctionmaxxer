import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { backfillItems } from "./backfill.js";
import { collectOnce } from "./collector.js";
import type { DataSource } from "./dataSource.js";
import { openDb, type Db } from "./db.js";
import { sendPendingAlerts, tabAlertLine } from "./notify.js";
import { loadSettings } from "./settings.js";
import { checkTabAlerts, deleteTabRule, listTabAlerts, listTabRules, saveTabRule } from "./tabAlerts.js";
import type { CommodityListing } from "./types.js";

const HOUR = 3600;
const WEBHOOK = "https://discord.com/api/webhooks/123/abc";

// Listings are [itemId, unitPrice, quantity]. Items 1 and 2 sell to a vendor for 50c.
async function snapshot(db: Db, hour: number, listings: Array<[number, number, number]>) {
  const commodities: CommodityListing[] = listings.map(([itemId, unitPrice, quantity], index) => ({
    id: hour * 1000 + index,
    item: { id: itemId },
    quantity,
    unit_price: unitPrice,
    time_left: "LONG",
  }));
  const source: DataSource = {
    listHouses: async () => [],
    getItem: async (id) => ({ id, name: `Item ${id}`, sellPrice: 50 }),
    fetchSnapshot: async () => ({ houseId: 113, takenAt: hour * HOUR, items: [], commodities }),
  };
  await collectOnce({ db, source, rulesetId: 1, houseId: 113 });
  await backfillItems({ db, source });
}

const check = (db: Db, hour: number) =>
  checkTabAlerts({ db, houseId: 113, settings: loadSettings(db), now: () => hour * HOUR });

describe("tab alerts", () => {
  it("raises an alert for what a tab lists above the rule's profit, once a day per item", async () => {
    const db = openDb(":memory:");
    // Item 1: 10 at 20c is 300c of vendor profit. Item 2: 2 at 40c is 20c.
    await snapshot(db, 1, [[1, 20, 10], [2, 40, 2]]);
    assert.equal(check(db, 1), 0); // no rules yet

    saveTabRule(db, 113, { kind: "vendor", minProfit: 100 });
    assert.deepEqual(listTabRules(db, 113), [{ kind: "vendor", minProfit: 100 }]);
    assert.equal(check(db, 1), 1);
    assert.equal(check(db, 2), 0); // still listed an hour later
    assert.deepEqual(
      listTabAlerts(db, 113).map((a) => [a.kind, a.itemId, a.name, a.profit, a.notifiedAt]),
      [["vendor", 1, "Item 1", 300, null]],
    );

    assert.equal(check(db, 26), 1); // a day on, it alerts again
  });

  it("changes a rule's amount and turns it off", async () => {
    const db = openDb(":memory:");
    await snapshot(db, 1, [[1, 20, 10], [2, 40, 2]]);
    saveTabRule(db, 113, { kind: "vendor", minProfit: 100 });
    saveTabRule(db, 113, { kind: "vendor", minProfit: 10 });
    assert.equal(check(db, 1), 2);

    assert.equal(deleteTabRule(db, 113, "vendor"), true);
    assert.equal(deleteTabRule(db, 113, "vendor"), false);
    assert.equal(check(db, 30), 0);
  });

  it("sends tab alerts to Discord and marks them sent", async () => {
    const db = openDb(":memory:");
    await snapshot(db, 1, [[1, 20, 10]]);
    saveTabRule(db, 113, { kind: "vendor", minProfit: 100 });
    check(db, 1);

    const bodies: string[] = [];
    const fetch = (async (_url: unknown, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return new Response(null, { status: 204 });
    }) as typeof globalThis.fetch;
    const result = await sendPendingAlerts({ db, webhookUrl: WEBHOOK, siteUrl: "https://example.test", fetch, now: () => HOUR });

    assert.deepEqual(result, { sent: 1 });
    assert.match(JSON.parse(bodies[0]!).content, /Vendor.*Item 1.*below vendor price, worth \*\*3s\*\*/);
    assert.equal(listTabAlerts(db, 113)[0]?.notifiedAt, HOUR);
    assert.deepEqual(await sendPendingAlerts({ db, webhookUrl: WEBHOOK, fetch, now: () => HOUR }), { sent: 0 });
  });

  it("words each tab's alert differently and links the item and the tab", () => {
    const alert = { id: 1, kind: "reset" as const, itemId: 7, name: "Pelt", profit: 123456 };
    assert.equal(tabAlertLine(alert), "💰 Resets: **Pelt** can be reset for about **12g 34s 56c**");
    assert.equal(
      tabAlertLine({ ...alert, kind: "craft" }, "https://example.test"),
      "💰 [Crafts](<https://example.test/crafts>): [**Pelt**](<https://example.test/item/7>) is worth crafting for about **12g 34s 56c**",
    );
  });

  it("is managed through the API", async () => {
    const { createApp } = await import("./api.js");
    const db = openDb(":memory:");
    const app = createApp({ db, defaultHouseId: 113 });
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address() as import("node:net").AddressInfo;
    const url = `http://127.0.0.1:${port}/api`;
    const post = (body: unknown) =>
      fetch(`${url}/tab-alerts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    try {
      assert.equal((await post({ kind: "vendor", minProfit: 50_000 })).status, 201);
      assert.equal((await post({ kind: "fishing", minProfit: 1 })).status, 400);
      assert.equal((await post({ kind: "vendor", minProfit: -1 })).status, 400);

      const list = (await (await fetch(`${url}/watchlist`)).json()) as any;
      assert.deepEqual(list.tabRules, [{ kind: "vendor", minProfit: 50_000 }]);
      assert.deepEqual(list.tabAlerts, []);

      assert.equal((await fetch(`${url}/tab-alerts/vendor`, { method: "DELETE" })).status, 204);
      assert.equal((await fetch(`${url}/tab-alerts/vendor`, { method: "DELETE" })).status, 404);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
