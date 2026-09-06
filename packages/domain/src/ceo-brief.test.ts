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

  it("computes factory recovery only from sold tons", () => {
    assert.equal(
      factoryRecovery([
        { soldSqft: 210, weightTons: 2 },
        { soldSqft: 0, weightTons: 10 },
      ]),
      105,
    );
    assert.equal(factoryRecovery([{ soldSqft: 0, weightTons: 4 }]), null);
  });
});
