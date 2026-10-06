import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { finishedPieceCount } from "./finished-count";

describe("finished piece count", () => {
  it("counts an identified slab once across grinding, resin and polishing", () => {
    const lines = [{ slabId: "a", slabCount: null }, { slabId: "b", slabCount: null }];
    const sessions = ["GRINDING", "RESIN", "POLISHING"].map((processType) => ({ processType, slabs: lines }));
    assert.equal(finishedPieceCount(sessions), 2);
  });

  it("counts lot lines only at the polishing stage", () => {
    const lot = [{ rawBlockId: "block", slabCount: 50 }];
    const sessions = ["GRINDING", "RESIN", "POLISHING"].map((processType) => ({ processType, slabs: lot }));
    assert.equal(finishedPieceCount(sessions), 50);
    assert.equal(finishedPieceCount([{ processType: "GRINDING", slabs: lot }]), 0);
  });

  it("reads related rows as well as bare ids", () => {
    const sessions = [
      { processType: "POLISHING", slabs: [{ slab: { id: "a" }, slabCount: null }, { rawBlock: {}, slabCount: 7 }] },
      { processType: "RESIN", slabs: [{ slabId: "a", slabCount: null }] },
    ];
    assert.equal(finishedPieceCount(sessions), 8);
  });
});
