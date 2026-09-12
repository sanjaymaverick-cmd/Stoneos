import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDaybookXml } from "./tally-parse";

const xml = `
  <ENVELOPE>
    <VOUCHER>
      <DATE>20260912</DATE>
      <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
      <VOUCHERNUMBER>INV-1</VOUCHERNUMBER>
      <PARTYLEDGERNAME>South Yard</PARTYLEDGERNAME>
      <LEDGERNAME>South Yard</LEDGERNAME>
      <AMOUNT>-7200.00</AMOUNT>
      <LEDGERNAME>Sales</LEDGERNAME>
      <AMOUNT>7200.00</AMOUNT>
    </VOUCHER>
    <VOUCHER>
      <DATE>20260912</DATE>
      <VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>
      <VOUCHERNUMBER>PMT-1</VOUCHERNUMBER>
      <PARTYLEDGERNAME>South Yard</PARTYLEDGERNAME>
      <LEDGERNAME>South Yard</LEDGERNAME>
      <AMOUNT>7200.00</AMOUNT>
      <LEDGERNAME>Bank</LEDGERNAME>
      <AMOUNT>-7200.00</AMOUNT>
    </VOUCHER>
  </ENVELOPE>`;

describe("tally parser", () => {
  it("counts vouchers and unique ledgers without writing inventory", () => {
    const parsed = parseDaybookXml(xml);
    assert.equal(parsed.vouchers, 2);
    assert.deepEqual(parsed.ledgers.sort(), ["Bank", "Sales", "South Yard"]);
    assert.equal(parsed.writesInventory, false);
  });

  it("keeps group sales and payments as voucher rows, not StoneOS stock", () => {
    const parsed = parseDaybookXml(xml);
    assert.equal(parsed.byType.Sales, 1);
    assert.equal(parsed.byType.Payment, 1);
    assert.equal(parsed.totalAbsAmount, 14400);
    assert.equal(parsed.entries[0]?.party, "South Yard");
    assert.equal(parsed.entries[0]?.type, "Sales");
    assert.equal(Math.abs(parsed.entries[0]?.amount ?? 0), 7200);
    assert.equal(parsed.entries[1]?.type, "Payment");
  });
});
