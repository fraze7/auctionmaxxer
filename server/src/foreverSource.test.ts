// Tests for ForeverSource. No network: a fake `fetch` plays Blizzard's part
// and records every request, so we can check what was sent.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForeverSource } from "./foreverSource.js";

const API = "https://eu.api.blizzard.com";
const TOKEN_URL = "https://oauth.battle.net/token";
const HOUSE_URL = `${API}/data/wow/ruleset/1/auctions/113?namespace=dynamic-forever-eu`;
const COMMODITIES_URL = `${API}/data/wow/ruleset/1/auctions/113/commodities?namespace=dynamic-forever-eu`;
const ITEM_URL = `${API}/data/wow/item/2447?namespace=static-forever-eu`;

const TAKEN = "Mon, 09 Nov 2026 16:12:19 GMT";
const TAKEN_AT = Date.parse(TAKEN) / 1000;

interface Call {
  url: string;
  headers: Record<string, string>;
}

type Handler = (call: Call) => Response;

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, ...init });
}

const tokenResponse = () => json({ access_token: "test-token", token_type: "bearer", expires_in: 86399 });

const houseBody = {
  id: 113,
  auctions: [{ id: 1, item: { id: 100 }, quantity: 1, buyout: 5000, time_left: "LONG" }],
  commodities: { href: COMMODITIES_URL },
};
const commoditiesBody = {
  auctions: [{ id: 2, item: { id: 2447 }, quantity: 5, unit_price: 36, time_left: "SHORT" }],
};

// Builds a ForeverSource wired to a fake fetch. `routes` maps a URL to what
// the fake Blizzard answers; an unknown URL fails the test.
function setup(routes: Record<string, Handler>) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  let clock = 1_000_000;

  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const call = { url, headers: (init?.headers ?? {}) as Record<string, string> };
    calls.push(call);
    const handler = routes[url];
    if (!handler) throw new Error(`Test made an unexpected request: ${url}`);
    return handler(call);
  }) as typeof fetch;

  const source = new ForeverSource({
    clientId: "id",
    clientSecret: "secret",
    rulesetId: 1,
    fetch: fakeFetch,
    sleep: async (ms) => void sleeps.push(ms), // record the wait, don't actually wait
    now: () => clock,
  });

  return {
    source,
    calls,
    sleeps,
    countCalls: (url: string) => calls.filter((c) => c.url === url).length,
    advanceClock: (ms: number) => void (clock += ms),
  };
}

// Answers with each response in turn, repeating the last one.
function sequence(...responses: Array<() => Response>): Handler {
  let i = 0;
  return () => {
    const next = responses[Math.min(i++, responses.length - 1)];
    if (!next) throw new Error("sequence() needs at least one response");
    return next();
  };
}

describe("ForeverSource.fetchSnapshot", () => {
  it("builds a snapshot from the house and the commodities link", async () => {
    const t = setup({
      [TOKEN_URL]: tokenResponse,
      [HOUSE_URL]: () => json(houseBody, { headers: { "Last-Modified": TAKEN } }),
      [COMMODITIES_URL]: () =>
        json(commoditiesBody, { headers: { "Last-Modified": "Mon, 09 Nov 2026 16:12:08 GMT" } }),
    });

    const snapshot = await t.source.fetchSnapshot(113);

    assert.equal(snapshot?.houseId, 113);
    assert.equal(snapshot?.takenAt, TAKEN_AT); // from Last-Modified, not from our clock
    assert.deepEqual(snapshot?.commodities, commoditiesBody.auctions);
    assert.deepEqual(snapshot?.items, houseBody.auctions);

    const houseCall = t.calls.find((c) => c.url === HOUSE_URL);
    assert.equal(houseCall?.headers.Authorization, "Bearer test-token");
    assert.equal(houseCall?.headers["If-Modified-Since"], undefined);
  });

  it("returns null on 304 and never asks for commodities", async () => {
    const t = setup({
      [TOKEN_URL]: tokenResponse,
      [HOUSE_URL]: () => new Response(null, { status: 304 }),
    });

    assert.equal(await t.source.fetchSnapshot(113, TAKEN_AT), null);

    const houseCall = t.calls.find((c) => c.url === HOUSE_URL);
    assert.equal(houseCall?.headers["If-Modified-Since"], TAKEN);
    assert.equal(t.countCalls(COMMODITIES_URL), 0);
  });

  it("returns null when Blizzard ignores If-Modified-Since and resends the same snapshot", async () => {
    const t = setup({
      [TOKEN_URL]: tokenResponse,
      [HOUSE_URL]: () => json(houseBody, { headers: { "Last-Modified": TAKEN } }),
    });
    assert.equal(await t.source.fetchSnapshot(113, TAKEN_AT), null);
  });

  it("fails loudly when the response shape changes", async () => {
    const t = setup({
      [TOKEN_URL]: tokenResponse,
      [HOUSE_URL]: () => json({ id: 113, listings: [] }, { headers: { "Last-Modified": TAKEN } }),
    });
    await assert.rejects(t.source.fetchSnapshot(113), /Unexpected response shape/);
  });

  it("fails when Last-Modified is missing", async () => {
    const t = setup({ [TOKEN_URL]: tokenResponse, [HOUSE_URL]: () => json(houseBody) });
    await assert.rejects(t.source.fetchSnapshot(113), /Last-Modified/);
  });

  it("refuses to send the token to another host", async () => {
    const t = setup({
      [TOKEN_URL]: tokenResponse,
      [HOUSE_URL]: () =>
        json(
          { ...houseBody, commodities: { href: "https://evil.example/commodities" } },
          { headers: { "Last-Modified": TAKEN } },
        ),
    });
    await assert.rejects(t.source.fetchSnapshot(113), /another host/);
    assert.equal(t.countCalls("https://evil.example/commodities"), 0);
  });

  it("fails when items and commodities are from different hours", async () => {
    const t = setup({
      [TOKEN_URL]: tokenResponse,
      [HOUSE_URL]: () => json(houseBody, { headers: { "Last-Modified": TAKEN } }),
      [COMMODITIES_URL]: () =>
        json(commoditiesBody, { headers: { "Last-Modified": "Mon, 09 Nov 2026 15:12:08 GMT" } }),
    });
    await assert.rejects(t.source.fetchSnapshot(113), /different snapshots/);
  });
});

describe("ForeverSource retries", () => {
  const ok = () => json({ id: 2447, name: { en_GB: "Peacebloom" }, quality: { type: "COMMON" } });

  it("retries a 503 with growing waits, then succeeds", async () => {
    const t = setup({
      [TOKEN_URL]: tokenResponse,
      [ITEM_URL]: sequence(
        () => new Response(null, { status: 503 }),
        () => new Response(null, { status: 503 }),
        ok,
      ),
    });

    assert.equal((await t.source.getItem(2447))?.name, "Peacebloom");
    assert.equal(t.countCalls(ITEM_URL), 3);
    assert.deepEqual(t.sleeps, [1000, 2000]);
  });

  it("waits as long as Retry-After says on a 429", async () => {
    const t = setup({
      [TOKEN_URL]: tokenResponse,
      [ITEM_URL]: sequence(() => new Response(null, { status: 429, headers: { "Retry-After": "7" } }), ok),
    });

    await t.source.getItem(2447);
    assert.deepEqual(t.sleeps, [7000]);
  });

  it("retries a network error", async () => {
    const t = setup({
      [TOKEN_URL]: tokenResponse,
      [ITEM_URL]: sequence(() => {
        throw new TypeError("fetch failed");
      }, ok),
    });

    assert.equal((await t.source.getItem(2447))?.name, "Peacebloom");
    assert.equal(t.countCalls(ITEM_URL), 2);
  });

  it("gives up after 4 attempts", async () => {
    const t = setup({
      [TOKEN_URL]: tokenResponse,
      [ITEM_URL]: () => new Response(null, { status: 500 }),
    });

    await assert.rejects(t.source.getItem(2447), /Gave up .* after 4 attempts: HTTP 500/);
    assert.equal(t.countCalls(ITEM_URL), 4);
  });

  it("does not retry an error that retrying can't fix", async () => {
    const t = setup({
      [TOKEN_URL]: tokenResponse,
      [ITEM_URL]: () => new Response(null, { status: 403 }),
    });

    await assert.rejects(t.source.getItem(2447), /HTTP 403/);
    assert.equal(t.countCalls(ITEM_URL), 1);
    assert.deepEqual(t.sleeps, []);
  });
});

describe("ForeverSource token", () => {
  const item = () => json({ id: 2447, name: { en_GB: "Peacebloom" } });

  it("fetches the token once and reuses it", async () => {
    const t = setup({ [TOKEN_URL]: tokenResponse, [ITEM_URL]: item });

    await t.source.getItem(2447);
    await t.source.getItem(2447);
    await t.source.getItem(2447);

    assert.equal(t.countCalls(TOKEN_URL), 1);
    // The secret goes to the token endpoint as Basic auth, base64 of "id:secret".
    const tokenCall = t.calls.find((c) => c.url === TOKEN_URL);
    assert.equal(tokenCall?.headers.Authorization, `Basic ${btoa("id:secret")}`);
  });

  it("fetches a new token once the old one has expired", async () => {
    const t = setup({ [TOKEN_URL]: tokenResponse, [ITEM_URL]: item });

    await t.source.getItem(2447);
    t.advanceClock(24 * 60 * 60 * 1000);
    await t.source.getItem(2447);

    assert.equal(t.countCalls(TOKEN_URL), 2);
  });

  it("gets a fresh token and retries once after a 401", async () => {
    const t = setup({
      [TOKEN_URL]: tokenResponse,
      [ITEM_URL]: sequence(() => new Response(null, { status: 401 }), item),
    });

    assert.equal((await t.source.getItem(2447))?.name, "Peacebloom");
    assert.equal(t.countCalls(TOKEN_URL), 2);
  });

  it("stops after a second 401 instead of looping", async () => {
    const t = setup({
      [TOKEN_URL]: tokenResponse,
      [ITEM_URL]: () => new Response(null, { status: 401 }),
    });

    await assert.rejects(t.source.getItem(2447), /HTTP 401/);
    assert.equal(t.countCalls(ITEM_URL), 2);
  });

  it("explains itself when the credentials are wrong", async () => {
    const t = setup({ [TOKEN_URL]: () => new Response(null, { status: 401 }) });
    await assert.rejects(t.source.getItem(2447), /BLIZZARD_CLIENT_ID/);
  });
});

describe("ForeverSource.getItem and listHouses", () => {
  it("returns name and quality for a known item", async () => {
    const t = setup({
      [TOKEN_URL]: tokenResponse,
      [ITEM_URL]: () =>
        json({ id: 2447, name: { en_GB: "Peacebloom", de_DE: "Friedensblume" }, quality: { type: "COMMON" } }),
    });
    assert.deepEqual(await t.source.getItem(2447), { id: 2447, name: "Peacebloom", quality: "COMMON" });
  });

  it("returns null for an item Blizzard has no data for (404)", async () => {
    const t = setup({
      [TOKEN_URL]: tokenResponse,
      [ITEM_URL]: () => new Response(null, { status: 404 }),
    });
    assert.equal(await t.source.getItem(2447), null);
    assert.equal(t.countCalls(ITEM_URL), 1); // a 404 is an answer, not a reason to retry
  });

  it("lists the houses of the ruleset with their en_GB names", async () => {
    const t = setup({
      [TOKEN_URL]: tokenResponse,
      [`${API}/data/wow/ruleset/1/auctions/?namespace=dynamic-forever-eu`]: () =>
        json({
          auctions: [
            { id: 110, name: { en_GB: "Alliance Auction House", de_DE: "Auktionshaus der Allianz" } },
            { id: 113, name: { en_GB: "Horde Auction House" } },
          ],
        }),
    });
    assert.deepEqual(await t.source.listHouses(), [
      { id: 110, name: "Alliance Auction House" },
      { id: 113, name: "Horde Auction House" },
    ]);
  });
});
