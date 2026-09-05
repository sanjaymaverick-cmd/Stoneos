import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { damagedSlabCount, slabSerial } from "@stoneos/domain";

describe("inventory rules", () => {
  it("does not invent inventory rows for damaged slabs", () => {
    const good = 47;
    const cut = 50;
    assert.equal(damagedSlabCount(cut, good), 3);
    const serials = Array.from({ length: good }, (_, i) => slabSerial("V101", cut, i + 1));
    assert.equal(serials.length, 47);
    assert.equal(serials[0], "V101/50/01");
  });
});
