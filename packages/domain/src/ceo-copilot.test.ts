import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { answerCeoQuestion, ceoNarrative } from "./ceo-copilot.ts";
import { ceoExceptions } from "./ceo-brief.ts";

const snap = {
  factoryName: "Vedam Granites",
  operatingStatus: "LIVE",
  recoveryRatio: 110,
  outstandingAr: 120000,
  invoicedMtd: 400000,
  collectedMtd: 280000,
  expensesMtd: 50000,
  maintenanceDue: 1,
  openCutting: 2,
  openPolishing: 1,
  openOrders: 3,
  blocksOnHand: 8,
  slabsOnHand: 40,
  invoicedTotal: 900000,
  collectedTotal: 780000,
  damagedCost: 15000,
};

describe("snapshot copilot", () => {
  it("writes a brief from ledger numbers", () => {
    const text = ceoNarrative(snap, ceoExceptions(snap));
    assert.match(text, /110\.0/);
    assert.match(text, /Vedam/);
  });

  it("answers recovery from the snapshot only", () => {
    const { topic, answer } = answerCeoQuestion("Why is recovery low?", { ...snap, recoveryRatio: 80 });
    assert.equal(topic, "recovery");
    assert.match(answer, /80\.0/);
    assert.match(answer, /105/);
  });

  it("answers AR without inventing customers", () => {
    const { topic, answer } = answerCeoQuestion("What is outstanding collection?", snap);
    assert.equal(topic, "collections");
    assert.match(answer, /1,20,000|120000|1,20,000/);
  });
});
