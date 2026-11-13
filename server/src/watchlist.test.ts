// Discord is a fake fetch here, so nothing is really sent.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { createApp } from "./api.js";
import { collectOnce } from "./collector.js";
import type { DataSource } from "./dataSource.js";
import { openDb, type Db } from "./db.js";
import { alertLine, formatCopper, sendPendingAlerts } from "./notify.js";
import { checkWatches, deleteWatch, isPast, listAlerts, listWatches, saveWatch } from "./watchlist.js";
import type { CommodityListing } from "./types.js";

const HOUSE = 113;
const STONE = 12365;
const LINEN = 2589;
const HOUR = 3600;
const T0 = 1_800_000_000;
const WEBHOOK = "https://discord.com/api/webhooks/123456/abc-DEF_456";

let auctionId = 1;
const listing = (itemId: number, unitPrice: number, quantity = 10): CommodityListing => ({
  id: auctionId++,
  item: { id: itemId },
  quantity,
  unit_price: unitPrice,
  time_left: "LONG",
});

// Stores a snapshot, then runs the rule check as the hourly job does.
async function snapshot(db: Db, takenAt: number, commodities: CommodityListing[]): Promise<number> {
  const source: DataSource = {
    listHouses: async () => [],
    fetchSnapshot: async () => ({ houseId: HOUSE, takenAt, commodities, items: [] }),
    getItem: async () => null,
  };
  const result = await collectOnce({ db, source, rulesetId: 1, houseId: HOUSE, now: () => takenAt + 300 });
  assert.equal(result.status, "ok");
  return checkWatches({ db, houseId: HOUSE, now: () => takenAt + 300 });
}

// Dense Stone at 50s, Linen Cloth at 10s.
async function seededDb(): Promise<Db> {
  const db = openDb(":memory:");
  await snapshot(db, T0, [listing(STONE, 5000), listing(LINEN, 1000)]);
  db.prepare("UPDATE items SET name = 'Dense Stone', quality = 'COMMON', status = 'ok' WHERE item_id = ?").run(STONE);
  return db;
}

const watchStone = (db: Db, direction: "below" | "above", threshold: number) =>
  saveWatch({ db, houseId: HOUSE, itemId: STONE, direction, threshold, now: () => T0 + 600 });

describe("isPast", () => {
  it("counts a price exactly on the threshold as past it", () => {
    assert.equal(isPast("below", 4000, 4000), true);
    assert.equal(isPast("below", 4000, 4001), false);
    assert.equal(isPast("above", 9000, 9000), true);
    assert.equal(isPast("above", 9000, 8999), false);
  });
});

describe("saveWatch", () => {
  it("adds a rule and reports the item's current price", async () => {
    const db = await seededDb();
    const watch = watchStone(db, "below", 4000);

    assert.equal(watch?.name, "Dense Stone");
    assert.equal(watch?.currentMin, 5000);
    assert.equal(watch?.triggeredAt, null);
    assert.equal(listAlerts(db, HOUSE).length, 0);
  });

  it("changes the threshold instead of adding a second rule", async () => {
    const db = await seededDb();
    const first = watchStone(db, "below", 4000);
    const second = watchStone(db, "below", 3000);

    assert.equal(second?.id, first?.id);
    assert.equal(second?.threshold, 3000);
    assert.equal(listWatches(db, HOUSE).length, 1);
  });

  it("allows one 'below' and one 'above' rule on the same item", async () => {
    const db = await seededDb();
    watchStone(db, "below", 4000);
    watchStone(db, "above", 9000);
    assert.deepEqual(
      listWatches(db, HOUSE).map((w) => w.direction),
      ["below", "above"],
    );
  });

  it("alerts at once when the price is already past the threshold", async () => {
    const db = await seededDb();
    const watch = watchStone(db, "below", 6000); // it's 50s now

    assert.equal(watch?.triggeredAt, T0);
    assert.deepEqual(
      listAlerts(db, HOUSE).map((a) => [a.itemId, a.direction, a.threshold, a.price, a.takenAt]),
      [[STONE, "below", 6000, 5000, T0]],
    );
  });

  it("refuses an item that has never been seen", async () => {
    const db = await seededDb();
    assert.equal(saveWatch({ db, houseId: HOUSE, itemId: 424242, direction: "below", threshold: 1 }), null);
  });
});

describe("checkWatches", () => {
  it("alerts once when the price crosses, not every hour it stays there", async () => {
    const db = await seededDb();
    watchStone(db, "below", 4000);

    assert.equal(await snapshot(db, T0 + HOUR, [listing(STONE, 4500)]), 0); // still above
    assert.equal(await snapshot(db, T0 + 2 * HOUR, [listing(STONE, 3800)]), 1); // crossed
    assert.equal(await snapshot(db, T0 + 3 * HOUR, [listing(STONE, 3700)]), 0); // still below: quiet
    assert.equal(await snapshot(db, T0 + 4 * HOUR, [listing(STONE, 3900)]), 0);

    const alerts = listAlerts(db, HOUSE);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0]?.price, 3800);
    assert.equal(alerts[0]?.takenAt, T0 + 2 * HOUR);
    assert.equal(listWatches(db, HOUSE)[0]?.triggeredAt, T0 + 2 * HOUR);
  });

  it("re-arms when the price goes back, and alerts again on the next crossing", async () => {
    const db = await seededDb();
    watchStone(db, "below", 4000);

    assert.equal(await snapshot(db, T0 + HOUR, [listing(STONE, 3800)]), 1);
    assert.equal(await snapshot(db, T0 + 2 * HOUR, [listing(STONE, 4200)]), 0); // recovered
    assert.equal(listWatches(db, HOUSE)[0]?.triggeredAt, null);
    assert.equal(await snapshot(db, T0 + 3 * HOUR, [listing(STONE, 3500)]), 1); // crossed again

    assert.deepEqual(
      listAlerts(db, HOUSE).map((a) => a.price),
      [3500, 3800], // newest first
    );
  });

  it("handles 'above' rules the other way round", async () => {
    const db = await seededDb();
    watchStone(db, "above", 9000);

    assert.equal(await snapshot(db, T0 + HOUR, [listing(STONE, 8000)]), 0);
    assert.equal(await snapshot(db, T0 + 2 * HOUR, [listing(STONE, 9500)]), 1);
    assert.equal(listAlerts(db, HOUSE)[0]?.direction, "above");
  });

  it("uses the cheapest listing, not the dearer ones", async () => {
    const db = await seededDb();
    watchStone(db, "below", 4000);
    assert.equal(await snapshot(db, T0 + HOUR, [listing(STONE, 9000), listing(STONE, 3900, 1)]), 1);
  });

  it("leaves a rule alone while its item isn't listed at all", async () => {
    const db = await seededDb();
    watchStone(db, "below", 4000);
    await snapshot(db, T0 + HOUR, [listing(STONE, 3800)]);

    // Sold out for an hour: no price, so the rule keeps its triggered state...
    assert.equal(await snapshot(db, T0 + 2 * HOUR, [listing(LINEN, 1000)]), 0);
    assert.equal(listWatches(db, HOUSE)[0]?.triggeredAt, T0 + HOUR);
    // ...and coming back still cheap is not a new crossing.
    assert.equal(await snapshot(db, T0 + 3 * HOUR, [listing(STONE, 3700)]), 0);
  });

  it("raises nothing when run twice on the same snapshot", async () => {
    const db = await seededDb();
    watchStone(db, "below", 4000);
    assert.equal(await snapshot(db, T0 + HOUR, [listing(STONE, 3800)]), 1);
    assert.equal(checkWatches({ db, houseId: HOUSE }), 0);
  });

  it("keeps the alert history when a rule is deleted", async () => {
    const db = await seededDb();
    const watch = watchStone(db, "below", 6000);
    assert.equal(deleteWatch(db, watch!.id), true);
    assert.equal(deleteWatch(db, watch!.id), false);
    assert.equal(listWatches(db, HOUSE).length, 0);
    assert.equal(listAlerts(db, HOUSE).length, 1);
  });
});

describe("Discord messages", () => {
  it("writes prices the way the game shows them", () => {
    assert.equal(formatCopper(123456), "12g 34s 56c");
    assert.equal(formatCopper(4000), "40s");
    assert.equal(formatCopper(20007), "2g 7c");
    assert.equal(formatCopper(5), "5c");
  });

  it("describes an alert, with a link when the site address is known", () => {
    const alert = { id: 1, itemId: STONE, name: "Dense Stone", direction: "below" as const, threshold: 4000, price: 3820 };
    assert.equal(alertLine(alert), "📉 **Dense Stone** is down to **38s 20c** (alert: 40s or less)");
    assert.equal(
      alertLine({ ...alert, direction: "above", name: null }, "https://example.test"),
      "📈 [**Item #12365**](<https://example.test/item/12365>) is up to **38s 20c** (alert: 40s or more)",
    );
  });
});

describe("sendPendingAlerts", () => {
  // Records what it was asked to send.
  function fakeDiscord(status = 204) {
    const calls: Array<{ url: string; body: any }> = [];
    const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(null, { status });
    }) as typeof globalThis.fetch;
    return { calls, fetch };
  }

  it("sends each alert once and marks it sent", async () => {
    const db = await seededDb();
    watchStone(db, "below", 6000);
    const discord = fakeDiscord();
    const options = { db, webhookUrl: WEBHOOK, fetch: discord.fetch, now: () => T0 + 900 };

    assert.deepEqual(await sendPendingAlerts(options), { sent: 1 });
    assert.equal(discord.calls.length, 1);
    assert.equal(discord.calls[0]?.url, WEBHOOK);
    assert.match(discord.calls[0]?.body.content, /Dense Stone.*50s.*60s or less/);
    assert.deepEqual(discord.calls[0]?.body.allowed_mentions, { parse: [] });
    assert.equal(listAlerts(db, HOUSE)[0]?.notifiedAt, T0 + 900);

    assert.deepEqual(await sendPendingAlerts(options), { sent: 0 });
    assert.equal(discord.calls.length, 1);
  });

  it("puts several alerts in one message", async () => {
    const db = await seededDb();
    watchStone(db, "below", 6000);
    saveWatch({ db, houseId: HOUSE, itemId: LINEN, direction: "above", threshold: 500 });
    const discord = fakeDiscord();

    assert.deepEqual(await sendPendingAlerts({ db, webhookUrl: WEBHOOK, fetch: discord.fetch }), { sent: 2 });
    assert.equal(discord.calls.length, 1);
    assert.equal(discord.calls[0]?.body.content.split("\n").length, 2);
  });

  it("keeps the alert for the next run when Discord refuses it", async () => {
    const db = await seededDb();
    watchStone(db, "below", 6000);

    const down = fakeDiscord(503);
    const failed = await sendPendingAlerts({ db, webhookUrl: WEBHOOK, fetch: down.fetch, now: () => T0 + 900 });
    assert.deepEqual(failed, { sent: 0, error: "Discord answered 503" });
    assert.equal(listAlerts(db, HOUSE)[0]?.notifiedAt, null);

    const up = fakeDiscord();
    assert.deepEqual(await sendPendingAlerts({ db, webhookUrl: WEBHOOK, fetch: up.fetch, now: () => T0 + 1500 }), {
      sent: 1,
    });
  });

  it("never puts the webhook address in an error", async () => {
    const db = await seededDb();
    watchStone(db, "below", 6000);
    const broken = (async () => {
      throw new Error(`connect failed for ${WEBHOOK}`);
    }) as unknown as typeof globalThis.fetch;

    const result = await sendPendingAlerts({ db, webhookUrl: WEBHOOK, fetch: broken });
    assert.equal(result.error, "could not reach Discord");
  });

  it("doesn't send alerts that are hours old", async () => {
    const db = await seededDb();
    watchStone(db, "below", 6000); // raised at T0 + 600
    const discord = fakeDiscord();
    const result = await sendPendingAlerts({ db, webhookUrl: WEBHOOK, fetch: discord.fetch, now: () => T0 + 7 * HOUR });
    assert.deepEqual(result, { sent: 0 });
    assert.equal(discord.calls.length, 0);
  });

  it("refuses to post anywhere that isn't Discord", async () => {
    const db = await seededDb();
    watchStone(db, "below", 6000);
    const discord = fakeDiscord();
    const result = await sendPendingAlerts({ db, webhookUrl: "https://example.test/hook", fetch: discord.fetch });
    assert.equal(result.sent, 0);
    assert.ok(result.error);
    assert.equal(discord.calls.length, 0);
  });
});

describe("the watchlist API", () => {
  type Call = (method: string, path: string, body?: unknown, contentType?: string) => Promise<{ status: number; body: any }>;

  async function withApi(db: Db, run: (call: Call) => Promise<void>) {
    const app = createApp({ db, defaultHouseId: HOUSE, now: () => T0 + 600, discordConfigured: true });
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      await run(async (method, path, body, contentType = "application/json") => {
        const response = await fetch(`http://127.0.0.1:${port}${path}`, {
          method,
          ...(body === undefined
            ? {}
            : { headers: { "Content-Type": contentType }, body: typeof body === "string" ? body : JSON.stringify(body) }),
        });
        const text = await response.text();
        return { status: response.status, body: text ? JSON.parse(text) : null };
      });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  it("adds a rule, lists it, and removes it", async () => {
    await withApi(await seededDb(), async (call) => {
      const added = await call("POST", "/api/watchlist", { itemId: STONE, direction: "below", threshold: 6000 });
      assert.equal(added.status, 201);
      assert.equal(added.body.name, "Dense Stone");
      assert.equal(added.body.triggeredAt, T0);

      const list = await call("GET", "/api/watchlist");
      assert.equal(list.status, 200);
      assert.equal(list.body.takenAt, T0);
      assert.equal(list.body.discordConfigured, true);
      assert.equal(list.body.watches.length, 1);
      assert.equal(list.body.watches[0].currentMin, 5000);
      assert.equal(list.body.alerts.length, 1);
      assert.equal(list.body.alerts[0].price, 5000);

      assert.equal((await call("DELETE", `/api/watchlist/${added.body.id}`)).status, 204);
      assert.equal((await call("DELETE", `/api/watchlist/${added.body.id}`)).status, 404);
      const after = await call("GET", "/api/watchlist");
      assert.equal(after.body.watches.length, 0);
      assert.equal(after.body.alerts.length, 1); // history is kept
    });
  });

  it("rejects bad rules", async () => {
    await withApi(await seededDb(), async (call) => {
      const bad = [
        { itemId: STONE, direction: "sideways", threshold: 100 },
        { itemId: STONE, direction: "below", threshold: 0 },
        { itemId: STONE, direction: "below", threshold: 12.5 },
        { itemId: STONE, direction: "below", threshold: "4000" },
        { direction: "below", threshold: 100 },
      ];
      for (const body of bad) assert.equal((await call("POST", "/api/watchlist", body)).status, 400, JSON.stringify(body));

      const unknown = await call("POST", "/api/watchlist", { itemId: 424242, direction: "below", threshold: 100 });
      assert.equal(unknown.status, 404);
    });
  });

  it("only accepts JSON bodies, which is what blocks cross-site requests", async () => {
    await withApi(await seededDb(), async (call) => {
      const rule = JSON.stringify({ itemId: STONE, direction: "below", threshold: 6000 });
      assert.equal((await call("POST", "/api/watchlist", rule, "text/plain")).status, 415);
      assert.equal((await call("POST", "/api/watchlist", "{not json", "application/json")).status, 400);
      assert.equal((await call("GET", "/api/watchlist")).body.watches.length, 0);
    });
  });
});
