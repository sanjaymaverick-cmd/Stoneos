import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { damagedCostAtRawBlock, recoveryRatio, RECOVERY_BENCHMARK_SQFT_PER_TON } from "./recovery.ts";
import { damagedSlabCount, slabSerial } from "./serials.ts";
import { operationalDateFor } from "./operational-day.ts";

describe("slab serials", () => {
  it("formats good-slab serials from block and cut count", () => {
    assert.equal(slabSerial("V101", 50, 1), "V101/50/01");
    assert.equal(slabSerial("V101", 50, 47), "V101/50/47");
  });

  it("tracks damaged pieces as a count, not inventory rows", () => {
    assert.equal(damagedSlabCount(50, 47), 3);
  });
});

describe("recovery", () => {
  it("uses sale-time sqft per ton against the 105 benchmark", () => {
    assert.equal(recoveryRatio(210, 2), 105);
    assert.equal(RECOVERY_BENCHMARK_SQFT_PER_TON, 105);
  });

  it("values damage at raw-block cost, never finished price", () => {
    assert.equal(damagedCostAtRawBlock(50, 5, 100000), 10000);
  });
});

describe("operational day", () => {
  it("assigns 06:59 to the previous calendar date", () => {
    const d = operationalDateFor(new Date("2026-09-06T06:59:00"));
    assert.equal(d.toISOString().slice(0, 10), "2026-09-05");
  });
});
