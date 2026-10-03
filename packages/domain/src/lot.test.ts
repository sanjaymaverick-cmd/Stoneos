import assert from "node:assert/strict";
import { test } from "node:test";
import {
  availableSlabs,
  checkCutCounts,
  checkSlabsAvailable,
  costPerSlab,
  checkSlabsPolishable,
  goodFromCut,
  groupTaxLines,
  lotLabel,
  lotSqft,
  polishableSlabs,
  totalTax,
  uniformRatePct,
  HSN_FINISHED_SLAB,
  HSN_ROUGH_BLOCK,
} from "./lot";

const lot = (good: number, broken: number, sold: number) => ({
  serialNumber: "VG-001",
  goodSlabCount: good,
  brokenSlabCount: broken,
  soldSlabCount: sold,
});

test("availability is good less broken less sold", () => {
  // The owner's own worked example: 96 cut, 6 lost on the saw, 3 broken in the yard,
  // 75 sold, 12 left.
  assert.equal(goodFromCut(96, 6), 90);
  assert.equal(availableSlabs(lot(90, 3, 75)), 12);
  assert.equal(availableSlabs(lot(90, 0, 0)), 90);
  assert.equal(availableSlabs(lot(90, 90, 0)), 0);
});

test("a count converts to area through the lot's slab size", () => {
  assert.equal(lotSqft(90, 49.5), 4455);
  assert.equal(lotSqft(12, 49.5), 594);
  // A cut that never recorded a slab size cannot claim an area.
  assert.equal(lotSqft(90, null), 0);
  assert.equal(lotSqft(90, undefined), 0);
});

test("cost per slab spreads both purchase legs over the good slabs only", () => {
  // ₹2,20,000 billed plus ₹2,20,000 cash over 90 good slabs.
  assert.equal(costPerSlab({ purchaseTaxable: 220_000, purchaseCashAmount: 220_000, goodSlabCount: 90 }), 440_000 / 90);
  // Cash-only purchase from an unregistered quarry.
  assert.equal(costPerSlab({ purchaseTaxable: 0, purchaseCashAmount: 90_000, goodSlabCount: 90 }), 1_000);
  // Nothing survived the saw: no cost to carry, and no division by zero.
  assert.equal(costPerSlab({ purchaseTaxable: 220_000, purchaseCashAmount: 0, goodSlabCount: 0 }), 0);
});

test("overselling a lot is refused, and the message names both numbers", () => {
  assert.equal(checkSlabsAvailable(lot(90, 3, 75), 12), null);
  const issue = checkSlabsAvailable(lot(90, 3, 75), 100);
  assert.ok(issue);
  assert.match(issue.message, /VG-001 has 12 slabs available/);
  assert.match(issue.message, /100 cannot be taken/);
});

test("a slab count must be a whole number above zero", () => {
  for (const bad of [0, -5, 2.5, Number.NaN]) {
    const issue = checkSlabsAvailable(lot(90, 0, 0), bad);
    assert.ok(issue, `${bad} should be refused`);
    assert.match(issue.message, /whole number above zero/);
  }
});

test("a cut must account for every piece off the saw", () => {
  assert.equal(checkCutCounts(96, 6), null);
  assert.equal(checkCutCounts(96, 0), null);
  assert.match(checkCutCounts(96, 97)!.message, /Cannot damage 97 slabs out of 96/);
  assert.match(checkCutCounts(0, 0)!.message, /whole number above zero/);
  assert.match(checkCutCounts(96, -1)!.message, /zero or a whole number/);
  assert.match(checkCutCounts(96.5, 0)!.message, /whole number above zero/);
});

test("tax groups by HSN and rate, so one bill can mix slabs and rough blocks", () => {
  const groups = groupTaxLines(
    [
      { hsnCode: HSN_FINISHED_SLAB, gstRatePct: 18, taxableMinor: 8_415_000 },
      { hsnCode: HSN_FINISHED_SLAB, gstRatePct: 18, taxableMinor: 8_910_000 },
      { hsnCode: HSN_ROUGH_BLOCK, gstRatePct: 5, taxableMinor: 10_000_000 },
    ],
    false,
  );
  assert.equal(groups.length, 2, "two HSN/rate pairs, not three lines");

  const block = groups.find((g) => g.hsnCode === HSN_ROUGH_BLOCK)!;
  assert.equal(block.taxableMinor, 10_000_000);
  assert.equal(block.cgstMinor + block.sgstMinor, 500_000, "5% of 1,00,000");

  const slab = groups.find((g) => g.hsnCode === HSN_FINISHED_SLAB)!;
  assert.equal(slab.taxableMinor, 17_325_000, "the two slab lines are added before tax");
  assert.equal(slab.cgstMinor + slab.sgstMinor, 3_118_500, "18% of 1,73,250");
  assert.equal(slab.igstMinor, 0);
});

test("an inter-state supply carries IGST and no CGST or SGST", () => {
  const [group] = groupTaxLines(
    [{ hsnCode: HSN_FINISHED_SLAB, gstRatePct: 18, taxableMinor: 3_267_000 }],
    true,
  );
  assert.equal(group!.igstMinor, 588_060, "18% of 32,670 is 5,880.60");
  assert.equal(group!.cgstMinor, 0);
  assert.equal(group!.sgstMinor, 0);
});

test("CGST and SGST always add back to the whole tax, odd paise included", () => {
  // 18% of 1000.05 is 180.009 -> 18001 paise, which does not halve evenly.
  const [group] = groupTaxLines(
    [{ hsnCode: HSN_FINISHED_SLAB, gstRatePct: 18, taxableMinor: 100_005 }],
    false,
  );
  assert.equal(group!.cgstMinor + group!.sgstMinor, 18_001, "no paisa may go missing");
  assert.notEqual(group!.cgstMinor, group!.sgstMinor, "an odd total cannot halve evenly");
});

test("totals sum the groups and carry the payable", () => {
  const groups = groupTaxLines(
    [
      { hsnCode: HSN_FINISHED_SLAB, gstRatePct: 18, taxableMinor: 10_000_000 },
      { hsnCode: HSN_ROUGH_BLOCK, gstRatePct: 5, taxableMinor: 5_000_000 },
    ],
    false,
  );
  const totals = totalTax(groups);
  assert.equal(totals.taxableMinor, 15_000_000);
  assert.equal(totals.taxMinor, 2_050_000, "18% of 1,00,000 plus 5% of 50,000");
  assert.equal(totals.cgstMinor + totals.sgstMinor, 2_050_000);
  assert.equal(totals.igstMinor, 0);
  assert.equal(totals.totalMinor, 17_050_000, "taxable plus tax is what the buyer owes");
});

test("a mixed-rate bill reports no single rate; a uniform one reports its rate", () => {
  const mixed = groupTaxLines(
    [
      { hsnCode: HSN_FINISHED_SLAB, gstRatePct: 18, taxableMinor: 100 },
      { hsnCode: HSN_ROUGH_BLOCK, gstRatePct: 5, taxableMinor: 100 },
    ],
    false,
  );
  assert.equal(uniformRatePct(mixed), null);

  const uniform = groupTaxLines(
    [{ hsnCode: HSN_FINISHED_SLAB, gstRatePct: 18, taxableMinor: 100 }],
    false,
  );
  assert.equal(uniformRatePct(uniform), 18);
  assert.equal(uniformRatePct([]), null);
});

test("a lot is labelled by its block and its live count", () => {
  assert.equal(lotLabel("VG01", 70), "VG01-70");
  // The same block after fifty go out. The label moves with the stock; it is not a
  // name the block keeps.
  assert.equal(lotLabel("VG01", 20), "VG01-20");
  assert.equal(lotLabel("VG-001", 0), "VG-001-0");
});

test("polishing is capped by what is unfinished, not by what is unsold", () => {
  // 90 cut, 4 broken, 30 already polished -> 56 left to polish.
  const block = { serialNumber: "VG01", goodSlabCount: 90, brokenSlabCount: 4, soldSlabCount: 50, polishedSlabCount: 30 };
  assert.equal(polishableSlabs(block), 56);
  // Deliberately more than the 36 available: slabs already sold were polished too,
  // and a lot is routinely finished before the lorry arrives.
  assert.equal(availableSlabs(block), 36);
  assert.equal(checkSlabsPolishable(block, 56), null);
  assert.equal(
    checkSlabsPolishable(block, 57)?.message,
    "VG01 has 56 unpolished slabs, so 57 cannot go through",
  );
});

test("polishing refuses nonsense counts and reads singular at one", () => {
  const block = { serialNumber: "VG01", goodSlabCount: 10, brokenSlabCount: 0, soldSlabCount: 0, polishedSlabCount: 9 };
  assert.equal(checkSlabsPolishable(block, 2)?.message, "VG01 has 1 unpolished slab, so 2 cannot go through");
  assert.equal(checkSlabsPolishable(block, 0)?.message, "Slab count must be a whole number above zero, got 0");
  assert.equal(checkSlabsPolishable(block, 1.5)?.message, "Slab count must be a whole number above zero, got 1.5");
});

test("a lot with no polishing recorded is entirely unpolished", () => {
  assert.equal(polishableSlabs({ goodSlabCount: 70, brokenSlabCount: 0, soldSlabCount: 0 }), 70);
});
