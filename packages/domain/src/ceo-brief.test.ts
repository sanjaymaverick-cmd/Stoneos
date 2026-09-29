import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ceoExceptions, factoryRecovery } from "./ceo-brief.ts";

const base = {
  operatingStatus: "LIVE",
  recoveryRatio: 105,
  outstandingAr: 0,
  invoicedMtd: 100000,
  collectedMtd: 100000,
  expensesMtd: 10000,
  maintenanceDue: 0,
  openCutting: 0,
  blocksOnHand: 4,
  slabsOnHand: 20,
};

describe("CEO brief rules", () => {
  it("flags a factory that is not LIVE", () => {
    const ex = ceoExceptions({ ...base, operatingStatus: "SETUP" });
    assert.equal(ex.some((e) => e.code === "FACTORY_NOT_LIVE"), true);
  });

  it("flags recovery below 105", () => {
    const ex = ceoExceptions({ ...base, recoveryRatio: 88 });
    const hit = ex.find((e) => e.code === "RECOVERY_BELOW_BENCHMARK");
    assert.ok(hit);
    assert.equal(hit?.severity, "critical");
  });

  it("does not invent exceptions on a clean LIVE factory", () => {
    assert.equal(ceoExceptions(base).length, 0);
  });

  it("flags overcollection instead of clamping AR to zero", () => {
    const ex = ceoExceptions({ ...base, outstandingAr: -500 });
    assert.equal(ex.some((e) => e.code === "OVERCOLLECTED"), true);
  });

  it("flags a withheld recovery figure instead of leaving the KPI blank", () => {
    const ex = ceoExceptions({ ...base, recoveryRatio: null, openBlocks: 3 });
    assert.equal(ex.some((e) => e.code === "RECOVERY_NOT_MEASURABLE"), true);
  });
});

const settled = (soldSqft: number, weightTons: number, slabCount = 10) => ({
  soldSqft,
  weightTons,
  slabCount,
  unsoldSlabCount: 0,
});

describe("factory recovery", () => {
  it("reports a sold-out block at its true ratio", () => {
    assert.equal(factoryRecovery([settled(210, 2)]).ratio, 105);
    assert.equal(factoryRecovery([settled(2400, 20)]).ratio, 120);
  });

  // The regression this function was written to stop. The previous implementation
  // capped each block's tonnage at soldSqft/105, which made every value >= 105.
  it("reports under-recovery as under-recovery", () => {
    assert.equal(factoryRecovery([settled(1000, 20)]).ratio, 50);
    assert.equal(factoryRecovery([settled(300, 30)]).ratio, 10);
    const mixed = factoryRecovery([settled(1000, 20), settled(800, 18), settled(1500, 16)]);
    assert.equal(Math.round((mixed.ratio ?? 0) * 100) / 100, 61.11);
    assert.ok((mixed.ratio ?? 0) < 105, "a bad yard must read below the benchmark");
  });

  it("can produce a value below 105 for arbitrary inputs", () => {
    // Property check. The old clamp made this unsatisfiable for every possible yard.
    let min = Infinity;
    for (let i = 0; i < 20_000; i += 1) {
      const rows = Array.from({ length: 1 + (i % 5) }, () =>
        settled(Math.random() * 5000, Math.random() * 40),
      );
      const v = factoryRecovery(rows).ratio;
      if (v !== null && v < min) min = v;
    }
    assert.ok(min < 90, `expected a yard below 90 sqft/ton, lowest seen was ${min}`);
  });

  it("excludes blocks that still hold sellable slabs rather than discounting their tons", () => {
    const out = factoryRecovery([
      settled(1000, 20),
      { soldSqft: 400, weightTons: 30, slabCount: 12, unsoldSlabCount: 5 },
    ]);
    assert.equal(out.ratio, 50, "the open block must not move the ratio at all");
    assert.equal(out.settledBlocks, 1);
    assert.equal(out.openBlocks, 1);
    assert.equal(out.tons, 20);
  });

  it("withholds the ratio instead of guessing when nothing has settled", () => {
    const out = factoryRecovery([
      { soldSqft: 400, weightTons: 30, slabCount: 12, unsoldSlabCount: 5 },
    ]);
    assert.equal(out.ratio, null);
    assert.equal(out.openBlocks, 1);
    assert.equal(out.settledBlocks, 0);
  });

  it("ignores blocks that were never cut or carry no weight", () => {
    const out = factoryRecovery([
      { soldSqft: 0, weightTons: 10, slabCount: 0, unsoldSlabCount: 0 },
      { soldSqft: 500, weightTons: 0, slabCount: 8, unsoldSlabCount: 0 },
    ]);
    assert.equal(out.ratio, null);
    assert.equal(out.settledBlocks, 0);
    assert.equal(out.openBlocks, 0);
  });

  it("counts a sold-out block that yielded nothing as a total loss, not as missing data", () => {
    const out = factoryRecovery([settled(0, 20)]);
    assert.equal(out.ratio, 0);
    assert.equal(out.settledBlocks, 1);
  });
});
