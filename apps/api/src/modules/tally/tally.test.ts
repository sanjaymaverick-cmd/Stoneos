import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDaybookXml } from "./tally.service";

describe("tally parser", () => {
  it("counts vouchers and unique ledgers without writing inventory", () => {
    const xml = `
      <ENVELOPE>
        <VOUCHER><LEDGERNAME>Sales</LEDGERNAME></VOUCHER>
        <VOUCHER><LEDGERNAME>Cash</LEDGERNAME></VOUCHER>
        <VOUCHER><LEDGERNAME>Sales</LEDGERNAME></VOUCHER>
      </ENVELOPE>`;
    const parsed = parseDaybookXml(xml);
    assert.equal(parsed.vouchers, 3);
    assert.deepEqual(parsed.ledgers.sort(), ["Cash", "Sales"]);
  });
});
