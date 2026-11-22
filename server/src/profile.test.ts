import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openDb } from "./db.js";
import { canMake, loadProfile, loadSkills, saveProfile } from "./profile.js";

describe("the character profile", () => {
  it("lists every profession, with a skill for the ones the character has", () => {
    const db = openDb(":memory:");
    assert.equal(loadProfile(db).every((p) => p.skill === null), true);

    saveProfile(db, { blacksmithing: 150, mining: 200, fishing: 10 });
    const profile = loadProfile(db);
    assert.deepEqual(
      profile.filter((p) => p.skill !== null).map((p) => [p.id, p.kind, p.skill]),
      [
        ["blacksmithing", "crafting", 150],
        ["mining", "gathering", 200],
      ],
    );
    assert.equal(profile.length, 8); // the seven Levelling professions and Cooking
  });

  it("replaces the whole profile on save", () => {
    const db = openDb(":memory:");
    saveProfile(db, { blacksmithing: 150, mining: 200 });
    saveProfile(db, { alchemy: 75 });
    assert.deepEqual([...loadSkills(db)], [["alchemy", 75]]);
  });

  it("knows what the character can make", () => {
    const none = new Map<string, number>();
    assert.equal(canMake(none, "alchemy", 300), true); // no profile: everything counts

    const smith = new Map([["blacksmithing", 150]]);
    assert.equal(canMake(smith, "blacksmithing", 150), true);
    assert.equal(canMake(smith, "blacksmithing", 151), false);
    assert.equal(canMake(smith, "alchemy", 1), false);

    // Mining counts too, for its smelting.
    const miner = new Map([["mining", 200]]);
    assert.equal(canMake(miner, "mining", 165), true);
    assert.equal(canMake(miner, "alchemy", 1), false);
  });

  it("is read and saved through the API", async () => {
    const { createApp } = await import("./api.js");
    const app = createApp({ db: openDb(":memory:"), defaultHouseId: 113 });
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address() as import("node:net").AddressInfo;
    const url = `http://127.0.0.1:${port}/api/profile`;
    const post = (body: unknown) =>
      fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    try {
      assert.equal((await post({ skills: { blacksmithing: 150, mining: 200 } })).status, 201);
      assert.equal((await post({ skills: { blacksmithing: 301 } })).status, 400);
      assert.equal((await post({ skills: { fishing: 10 } })).status, 400);

      const saved = (await (await fetch(url)).json()) as any;
      assert.deepEqual(
        saved.professions.filter((p: any) => p.skill !== null).map((p: any) => [p.id, p.skill]),
        [
          ["blacksmithing", 150],
          ["mining", 200],
        ],
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
