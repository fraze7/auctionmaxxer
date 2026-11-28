import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectOnce } from "./collector.js";
import type { DataSource } from "./dataSource.js";
import { openDb, type Db } from "./db.js";
import { importNodeLog, NodeLogFormatError, nodeStats, wilson } from "./nodes.js";

const ORE = 10620;
const STONE = 12365;
const CRYSTAL = 12363;
const PITCHBLENDE = 900001;

type Loot = Array<[id: number, name: string, qty: number]>;

let seq = 0;
function visit(node: string, loot: Loot, extra: Record<string, unknown> = {}) {
  seq++;
  return {
    id: `Forever-Fraze-${1_800_000_000 + seq}-${seq}`,
    realm: "Forever",
    character: "Fraze",
    t: 1_800_000_000 + seq,
    lastT: 1_800_000_010 + seq,
    kind: "mining",
    node,
    objectId: node === "Rich Thorium Vein" ? 175404 : 324,
    zone: "Un'Goro Crater",
    subzone: "The Slithering Scar",
    mapId: 1449,
    x: 52.31,
    y: 71,
    level: 54,
    skill: 285,
    taps: 3,
    items: Object.fromEntries(loot.map(([id, name, qty]) => [name, { id, name, qty }])),
    ...extra,
  };
}

// Written the way WoW writes SavedVariables.
function toLua(value: unknown, indent = ""): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const inner = indent + "\t";
  if (Array.isArray(value)) {
    return `{\n${value.map((v, i) => `${inner}${toLua(v, inner)}, -- [${i + 1}]\n`).join("")}${indent}}`;
  }
  const fields = Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => `${inner}[${JSON.stringify(k)}] = ${toLua(v, inner)},\n`)
    .join("");
  return `{\n${fields}${indent}}`;
}

const file = (entries: unknown[]) => `\nNodeLogDB = ${toLua({ version: 1, seq: entries.length, entries })}\n`;

// One snapshot where Thorium Ore costs 1s and Arcane Crystal 50g; nothing else is listed.
async function pricedDb(): Promise<Db> {
  const db = openDb(":memory:");
  const source: DataSource = {
    listHouses: async () => [],
    getItem: async () => null,
    fetchSnapshot: async () => ({
      houseId: 113,
      takenAt: 1000,
      items: [],
      commodities: [
        { id: 1, item: { id: ORE }, quantity: 50, unit_price: 100, time_left: "LONG" },
        { id: 2, item: { id: CRYSTAL }, quantity: 2, unit_price: 500_000, time_left: "LONG" },
      ],
    }),
  };
  await collectOnce({ db, source, rulesetId: 1, houseId: 113 });
  db.prepare("UPDATE items SET name = 'Arcane Crystal', quality = 'UNCOMMON', status = 'ok' WHERE item_id = ?").run(
    CRYSTAL,
  );
  return db;
}

describe("importNodeLog", () => {
  it("stores each visit and its loot, and re-uploading only updates", () => {
    const db = openDb(":memory:");
    const first = visit("Rich Thorium Vein", [
      [ORE, "Thorium Ore", 4],
      [STONE, "Dense Stone", 3],
    ]);
    assert.deepEqual(importNodeLog(db, file([first])), { visits: 1, added: 1, skipped: 0 });

    // Uploaded again after a fourth tap.
    const later = {
      ...first,
      taps: 4,
      items: { ...first.items, "Arcane Crystal": { id: CRYSTAL, name: "Arcane Crystal", qty: 1 } },
    };
    assert.deepEqual(importNodeLog(db, file([later])), { visits: 1, added: 0, skipped: 0 });

    assert.deepEqual(db.prepare("SELECT node, taps, object_id AS objectId, zone FROM node_visits").all(), [
      { node: "Rich Thorium Vein", taps: 4, objectId: 175404, zone: "Un'Goro Crater" },
    ]);
    assert.deepEqual(db.prepare("SELECT item_id AS itemId, quantity FROM node_loot ORDER BY item_id").all(), [
      { itemId: ORE, quantity: 4 },
      { itemId: CRYSTAL, quantity: 1 },
      { itemId: STONE, quantity: 3 },
    ]);
  });

  it("skips entries without the expected fields and keeps the rest", () => {
    const db = openDb(":memory:");
    const good = visit("Small Thorium Vein", [[ORE, "Thorium Ore", 2]]);
    const { node: _, ...noNode } = visit("Rich Thorium Vein", [[ORE, "Thorium Ore", 2]]);
    const fishing = visit("School of Fish", [[1, "Fish", 1]], { kind: "fishing" });
    assert.deepEqual(importNodeLog(db, file([good, noNode, fishing])), { visits: 3, added: 1, skipped: 2 });
  });

  it("accepts an empty realm, which Forever's client gives", () => {
    const db = openDb(":memory:");
    const entry = visit("Rich Thorium Vein", [[ORE, "Thorium Ore", 4]], { realm: "" });
    assert.deepEqual(importNodeLog(db, file([entry])), { visits: 1, added: 1, skipped: 0 });
  });

  it("accepts a file with no visits yet", () => {
    assert.deepEqual(importNodeLog(openDb(":memory:"), file([])), { visits: 0, added: 0, skipped: 0 });
  });

  it("rejects a file that is not NodeLog's", () => {
    const db = openDb(":memory:");
    assert.throws(() => importNodeLog(db, "OtherAddonDB = {}"), NodeLogFormatError);
    assert.throws(() => importNodeLog(db, "not lua at all {"), NodeLogFormatError);
  });
});

describe("nodeStats", () => {
  it("gives each node type's drop rates and its value per visit after the AH cut", async () => {
    const db = await pricedDb();
    const rich = [
      visit("Rich Thorium Vein", [
        [ORE, "Thorium Ore", 5],
        [CRYSTAL, "Arcane Crystal", 1],
        [PITCHBLENDE, "Pitchblende", 1],
      ]),
      visit("Rich Thorium Vein", [[ORE, "Thorium Ore", 4]]),
      visit("Rich Thorium Vein", [[ORE, "Thorium Ore", 3]], { zone: "Winterspring" }),
      visit("Rich Thorium Vein", [[ORE, "Thorium Ore", 4]]),
    ];
    importNodeLog(db, file([...rich, visit("Small Thorium Vein", [[ORE, "Thorium Ore", 2]])]));

    const stats = nodeStats(db, 113, 0.05);
    assert.equal(stats.takenAt, 1000);
    assert.equal(stats.visits, 5);
    assert.deepEqual(
      stats.nodes.map((n) => [n.node, n.visits, n.taps]),
      [
        ["Rich Thorium Vein", 4, 12],
        ["Small Thorium Vein", 1, 3],
      ],
    );

    const node = stats.nodes[0]!;
    assert.deepEqual(node.zones, [
      { zone: "Un'Goro Crater", visits: 3 },
      { zone: "Winterspring", visits: 1 },
    ]);
    // Crystal: 1 in 4 visits at 50g, 47g 50s after the cut -> 11g 87s 50c a visit.
    // Ore: 16 over 4 visits at 1s, 95c after the cut -> 3s 80c a visit.
    // Pitchblende is not listed, so it has no value.
    const byName = Object.fromEntries(node.items.map((item) => [item.name, item]));
    assert.deepEqual(
      node.items.map((item) => item.name),
      ["Arcane Crystal", "Thorium Ore", "Pitchblende"],
    );
    assert.equal(byName["Arcane Crystal"]!.share, 0.25);
    assert.equal(byName["Arcane Crystal"]!.quality, "UNCOMMON");
    assert.equal(byName["Arcane Crystal"]!.valuePerVisit, 118_750);
    assert.equal(byName["Thorium Ore"]!.perVisit, 4);
    assert.equal(byName["Thorium Ore"]!.valuePerVisit, 380);
    assert.equal(byName["Pitchblende"]!.unitPrice, null);
    assert.deepEqual([byName["Thorium Ore"]!.seen, byName["Pitchblende"]!.seen], [true, false]);
    assert.equal(byName["Pitchblende"]!.valuePerVisit, null);
    assert.equal(node.valuePerVisit, 118_750 + 380);
  });

  it("is empty with no visits or snapshots", () => {
    assert.deepEqual(nodeStats(openDb(":memory:"), 113, 0.05), {
      takenAt: null,
      visits: 0,
      lastVisitAt: null,
      nodes: [],
    });
  });
});

describe("wilson", () => {
  it("gives a wide range for a few visits and a narrow one for many", () => {
    const few = wilson(1, 10);
    assert.ok(Math.abs(few.low - 0.0179) < 0.001 && Math.abs(few.high - 0.4042) < 0.001);
    const many = wilson(100, 1000);
    assert.ok(Math.abs(many.low - 0.0829) < 0.001 && Math.abs(many.high - 0.1203) < 0.001);
    assert.deepEqual(wilson(0, 0), { low: 0, high: 1 });
  });
});

describe("/api/nodes", () => {
  it("takes an upload of NodeLog.lua and returns the stats", async () => {
    const { createApp } = await import("./api.js");
    const app = createApp({ db: await pricedDb(), defaultHouseId: 113 });
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address() as import("node:net").AddressInfo;
    const url = `http://127.0.0.1:${port}/api/nodes`;
    const post = (body: unknown, contentType = "application/json") =>
      fetch(url, { method: "POST", headers: { "Content-Type": contentType }, body: JSON.stringify(body) });
    try {
      const upload = file([visit("Rich Thorium Vein", [[ORE, "Thorium Ore", 4]])]);
      const stored = await post({ savedVariables: upload });
      assert.equal(stored.status, 201);
      assert.deepEqual(await stored.json(), { visits: 1, added: 1, skipped: 0 });

      const wrongFile = await post({ savedVariables: "SomethingElseDB = {}" });
      assert.equal(wrongFile.status, 400);
      assert.match(((await wrongFile.json()) as { error: string }).error, /No NodeLogDB/);
      assert.equal((await post({})).status, 400);
      assert.equal((await post({ savedVariables: upload }, "text/plain")).status, 415);

      const stats = (await (await fetch(url)).json()) as any;
      assert.equal(stats.ahCut, 0.05);
      assert.deepEqual(
        stats.nodes.map((n: any) => [n.node, n.visits, n.valuePerVisit]),
        [["Rich Thorium Vein", 1, 380]],
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
