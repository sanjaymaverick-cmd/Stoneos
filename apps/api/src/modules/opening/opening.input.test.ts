import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  readAccount,
  readBlock,
  readBlockNumber,
  readFinish,
  readMoney,
  readParty,
  readSettledAmounts,
  readStockItem,
  readTons,
} from "./opening.input";

test("money accepts Indian commas and a rupee sign", () => {
  assert.equal(readMoney("₹2,57,070", "Opening balance").toFixed(2), "257070.00");
  assert.equal(readMoney("1,000.5", "Opening balance").toFixed(2), "1000.50");
  assert.equal(readMoney("1,00,00,000.00", "Opening balance").toFixed(2), "10000000.00");
});

test("money rejects a third decimal and a blank", () => {
  assert.throws(() => readMoney("10.999", "Opening balance"), BadRequestException);
  assert.throws(() => readMoney("  ", "Opening balance"), BadRequestException);
});

test("tons keep three decimal places", () => {
  assert.equal(readTons("22.500", "Tons").toFixed(3), "22.500");
  assert.throws(() => readTons("1.1234", "Tons"), BadRequestException);
});

test("a customer can keep a single figure on the bank side", () => {
  const party = readParty({ name: "Shah", kind: "CUSTOMER", bankDue: "2,50,000", cashDue: "" });
  assert.equal(party.bankDue.toFixed(2), "250000.00");
  assert.equal(party.cashDue.toFixed(2), "0.00");
  assert.throws(() => readParty({ name: "Shah", kind: "CUSTOMER", bankDue: "0", cashDue: "0" }), /Enter an amount/);
  assert.throws(() => readParty({ name: "Shah", kind: "CUSTOMER", royaltyDue: "10", bankDue: "10" }), /bank due/);
});

test("a mine can open royalty on its own", () => {
  const mine = readParty({ name: "Sagar", kind: "MINE", royaltyDue: "33,600" });
  assert.equal(mine.royaltyDue.toFixed(2), "33600.00");
  assert.equal(mine.bankDue.toFixed(2), "0.00");
});

test("staff and advances are one cash amount", () => {
  const staff = readParty({ name: "Raju", kind: "STAFF", cashDue: "500" });
  assert.equal(staff.cashDue.toFixed(2), "500.00");
  assert.throws(() => readParty({ name: "Raju", kind: "STAFF", bankDue: "10", cashDue: "5" }), /one amount/);
  assert.throws(() => readParty({ name: "Dhanvikas", kind: "ADVANCE", cashDue: "0" }), /Enter an amount/);
});

test("a grouped block number is kept and royalty can stay blank", () => {
  assert.equal(readBlockNumber(" 656-658 "), "656-658");
  const block = readBlock({
    itemId: "11111111-1111-4111-8111-111111111111",
    blockNumber: "656-658",
    tons: "22.5",
    ratePerTon: "500",
    royaltyPerTon: "",
  });
  assert.equal(block.royaltyPerTon, null);
  assert.equal(block.tons.toFixed(3), "22.500");
});

test("stock of a new name asks for the item first", () => {
  assert.throws(
    () => readBlock({ blockNumber: "1", variety: "New stone", tons: "1", ratePerTon: "1" }),
    /Create this item first/,
  );
  const consumable = readStockItem({ kind: "CONSUMABLE", name: "Segment", unit: "nos" });
  assert.equal(consumable.kind, "CONSUMABLE");
  assert.equal(consumable.unit, "nos");
  assert.equal(readStockItem({ kind: "VARIETY", name: "Apple", unit: "kg" }).unit, "");
  assert.throws(() => readStockItem({ kind: "CONSUMABLE", name: "Blade" }), /Unit is required/);
});

test("finish names are the five yard finishes", () => {
  assert.equal(readFinish(" polish "), "Polish");
  assert.throws(() => readFinish("Flamed"), BadRequestException);
});

test("a blank settled box is skipped and a typed zero is kept", () => {
  const changes = readSettledAmounts({
    amounts: { CAPITAL: "", ICICI_INTEREST_PAID: "0", SUBSIDY_RECEIVED: "1,792" },
  });
  assert.deepEqual(
    changes.map((change) => [change.head, change.amount.toFixed(2)]),
    [
      ["SUBSIDY_RECEIVED", "1792.00"],
      ["ICICI_INTEREST_PAID", "0.00"],
    ],
  );
});

test("an account can open at zero", () => {
  const account = readAccount({ name: "ICICI", kind: "BANK", balance: "0" });
  assert.equal(account.kind, "BANK");
  assert.equal(account.balance.toFixed(2), "0.00");
});
