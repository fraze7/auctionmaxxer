import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { secondsUntilNextCheck } from "./nextCheck.js";

const TAKEN = 100_000;
const DUE = TAKEN + 3600 + 90;

describe("secondsUntilNextCheck", () => {
  it("checks every 10 minutes while the next update is far off", () => {
    assert.equal(secondsUntilNextCheck(TAKEN + 60, TAKEN, true), 600);
  });

  it("lands 90 seconds after the update is due", () => {
    assert.equal(secondsUntilNextCheck(DUE - 250, TAKEN, true), 250);
  });

  it("checks every 2 minutes once the update is late", () => {
    assert.equal(secondsUntilNextCheck(DUE, TAKEN, true), 120);
    assert.equal(secondsUntilNextCheck(DUE + 7200, TAKEN, true), 120);
  });

  it("stays at 10 minutes after a failed run or with nothing stored", () => {
    assert.equal(secondsUntilNextCheck(DUE + 60, TAKEN, false), 600);
    assert.equal(secondsUntilNextCheck(DUE, null, true), 600);
  });
});
