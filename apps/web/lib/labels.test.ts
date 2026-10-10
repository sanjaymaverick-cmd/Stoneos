import assert from "node:assert/strict";
import test from "node:test";
import { formatInr, userTypeLabel, userTypeWork } from "./labels";

test("rupees group in the Indian style", () => {
  assert.equal(formatInr("257070.00"), "₹2,57,070.00");
  assert.equal(formatInr("1000.00"), "₹1,000.00");
  assert.equal(formatInr("10000000.00"), "₹1,00,00,000.00");
  assert.equal(formatInr("0.5"), "₹0.50");
});

test("the three logins have plain names", () => {
  assert.equal(userTypeLabel("OWNER"), "Owner");
  assert.equal(userTypeLabel("OFFICE"), "Office");
  assert.equal(userTypeLabel("YARD"), "Yard");
  assert.match(userTypeWork("YARD"), /cutting/);
});
