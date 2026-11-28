import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSavedVariables } from "./savedVariables.js";

describe("parseSavedVariables", () => {
  it("reads a file as WoW writes it", () => {
    const file = `
NodeLogDB = {
	["seq"] = 2,
	["entries"] = {
		{
			["node"] = "Rich Thorium Vein",
			["x"] = 52.31,
			["items"] = {
				["Thorium Ore"] = {
					["id"] = 10620,
					["qty"] = 4,
				},
			},
		}, -- [1]
	},
	["version"] = 1,
}
`;
    assert.deepEqual(parseSavedVariables(file), {
      NodeLogDB: {
        seq: 2,
        entries: [{ node: "Rich Thorium Vein", x: 52.31, items: { "Thorium Ore": { id: 10620, qty: 4 } } }],
        version: 1,
      },
    });
  });

  it("handles escapes, byte escapes, raw UTF-8 and quotes", () => {
    const parsed = parseSavedVariables(
      String.raw`A = { "say \"hi\"\n", "back\\slash", "\195\152rjan", "Ørjan 🐉", 'single' }`,
    );
    assert.deepEqual(parsed.A, ['say "hi"\n', "back\\slash", "Ørjan", "Ørjan 🐉", "single"]);
  });

  it("reads numbers, booleans, nil, plain keys and several globals", () => {
    const parsed = parseSavedVariables(
      "A = { n = -1.5e2, hex = 0x1F, yes = true, no = false, gone = nil, [3] = 'x' } B = {}",
    );
    assert.deepEqual(parsed, { A: { n: -150, hex: 31, yes: true, no: false, "3": "x" }, B: [] });
  });

  it("skips comments, including block comments", () => {
    assert.deepEqual(parseSavedVariables("-- top\nA = --[[ note ]] { 1, 2 } -- end"), { A: [1, 2] });
  });

  it("explains where a broken file goes wrong", () => {
    assert.throws(() => parseSavedVariables('A = { "open'), /Unterminated string/);
    assert.throws(() => parseSavedVariables("A = { [1] 2 }"), /Expected '='/);
    assert.throws(() => parseSavedVariables("<html>"), /Expected a name/);
  });
});
