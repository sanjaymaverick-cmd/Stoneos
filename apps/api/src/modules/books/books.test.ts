import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import {
  BOOKS_STATEMENT_ROLES,
  CASH_DRAWER_LOCK_ROLES,
  CEO_ROLES,
  HISTORICAL_IMPORT_ROLES,
  INTAKE_DRAFT_ROLES,
} from "@stoneos/contracts";
import { assertAllowedRoles } from "../../common/session.guard.ts";
import { operationalDateFor } from "@stoneos/domain";
import {
  gstOnTaxable,
  stateCodeFromGstin,
  KHATA_AP_TOTAL_MINOR,
  KHATA_AR_TOTAL_MINOR,
  KHATA_PARTY_COUNT,
  parseFactoryDate,
  parseFactoryDateInput,
  rupeesToMinor,
} from "./money.ts";
import { assertVoucherLines } from "./posting.ts";
import { classifyPartyKind, looksLikeCashNarrationSplit, parseKhataList } from "./khata-parse.ts";
import { extractPdfText, previewKhata } from "./khata-pdf.ts";
import { ruleBasedDraft } from "./copilot.service.ts";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

describe("books voucher lines", () => {
  it("rejects an unbalanced voucher", () => {
    assert.throws(
      () =>
        assertVoucherLines([
          { ledgerCode: "AR", debit: 100, credit: 0 },
          { ledgerCode: "SALES", debit: 0, credit: 90 },
        ]),
      BadRequestException,
    );
  });

  it("rejects a line that is both debit and credit", () => {
    assert.throws(
      () =>
        assertVoucherLines([
          { ledgerCode: "AR", debit: 50, credit: 50 },
        ]),
      BadRequestException,
    );
  });

  it("accepts a balanced invoice split with GST", () => {
    const taxable = rupeesToMinor(3200);
    const gst = gstOnTaxable(taxable, { supplierStateCode: "08", placeOfSupplyStateCode: "08" });
    assert.doesNotThrow(() =>
      assertVoucherLines([
        { ledgerCode: "AR", debit: gst.totalMinor, credit: 0 },
        { ledgerCode: "SALES", debit: 0, credit: gst.taxableMinor },
        { ledgerCode: "GST_OUTPUT_CGST", debit: 0, credit: gst.cgstMinor },
        { ledgerCode: "GST_OUTPUT_SGST", debit: 0, credit: gst.sgstMinor },
      ]),
    );
  });
});

describe("GST on an ex-GST rate", () => {
  it("adds tax on top of the quoted value instead of carving it out", () => {
    const gst = gstOnTaxable(rupeesToMinor(1000), {
      supplierStateCode: "08",
      placeOfSupplyStateCode: "08",
    });
    assert.equal(gst.taxableMinor, 100_000, "the quoted value is the taxable value");
    assert.equal(gst.totalMinor, 118_000, "the customer owes 1180, not 1000");
    assert.equal(gst.ratePct, 18);
  });

  it("splits an intra-state supply into equal CGST and SGST halves", () => {
    const gst = gstOnTaxable(rupeesToMinor(1000), {
      supplierStateCode: "08",
      placeOfSupplyStateCode: "08",
    });
    assert.equal(gst.interState, false);
    assert.equal(gst.cgstMinor, 9_000);
    assert.equal(gst.sgstMinor, 9_000);
    assert.equal(gst.igstMinor, 0);
  });

  it("charges the whole rate as IGST when the place of supply is another state", () => {
    // Rajasthan factory (08) supplying Andhra Pradesh (37).
    const gst = gstOnTaxable(rupeesToMinor(1000), {
      supplierStateCode: "08",
      placeOfSupplyStateCode: "37",
    });
    assert.equal(gst.interState, true);
    assert.equal(gst.igstMinor, 18_000);
    assert.equal(gst.cgstMinor, 0);
    assert.equal(gst.sgstMinor, 0);
    assert.equal(gst.totalMinor, 118_000, "the customer owes the same either way");
  });

  it("never loses a paisa when the tax is an odd number of paise", () => {
    // 18% of 1000.05 is 180.009 -> 18001 paise, which does not halve evenly.
    const gst = gstOnTaxable(100_005, { supplierStateCode: "08", placeOfSupplyStateCode: "08" });
    assert.equal(gst.cgstMinor + gst.sgstMinor, gst.totalMinor - gst.taxableMinor);
    assert.equal(gst.cgstMinor + gst.sgstMinor + gst.igstMinor, 18_001);
  });

  it("treats 8 and 08 as the same state", () => {
    const gst = gstOnTaxable(rupeesToMinor(1000), {
      supplierStateCode: "8",
      placeOfSupplyStateCode: "08",
    });
    assert.equal(gst.interState, false, "a missing leading zero is not a different state");
  });

  it("supplies an unidentified buyer where the factory stands", () => {
    const gst = gstOnTaxable(rupeesToMinor(1000), {
      supplierStateCode: "08",
      placeOfSupplyStateCode: null,
    });
    assert.equal(gst.interState, false);
    assert.equal(gst.placeOfSupply, "08");
    assert.equal(gst.cgstMinor + gst.sgstMinor, 18_000);
  });

  it("charges nothing at all when the factory is not registered", () => {
    const gst = gstOnTaxable(rupeesToMinor(1000), {
      supplierStateCode: null,
      placeOfSupplyStateCode: "37",
      registered: false,
    });
    assert.equal(gst.totalMinor, 100_000, "an unregistered factory must not invent a liability");
    assert.equal(gst.ratePct, 0);
    assert.equal(gst.cgstMinor + gst.sgstMinor + gst.igstMinor, 0);
  });

  it("reads the supplying state out of the GSTIN", () => {
    assert.equal(stateCodeFromGstin("08AAUFV3603N1ZH"), "08");
    assert.equal(stateCodeFromGstin("37AAUFV3603N1ZH"), "37");
    assert.equal(stateCodeFromGstin("not-a-gstin"), null);
  });
});

describe("khata parse", () => {
  it("classifies job and supplier rows without minting invoices", () => {
    assert.equal(classifyPartyKind("NR JOB", 22351), "job");
    assert.equal(classifyPartyKind("Charging Job", 94461), "job");
    assert.equal(classifyPartyKind("Sri Balaji Granite Pandya ji", 46859), "supplier");
    assert.equal(classifyPartyKind("Rajasthan Tiles Mh", 0), "customer");
  });

  it("treats Cash 108162 as narration, not a payment", () => {
    assert.equal(looksLikeCashNarrationSplit("Vipul Cash 108162"), true);
    assert.equal(looksLikeCashNarrationSplit("Cash 97070"), true);
    assert.equal(looksLikeCashNarrationSplit("Invoice INV-2026-00001"), false);
  });

  it("parses JSON parties", () => {
    const rows = parseKhataList(JSON.stringify({ parties: [{ name: "Rajasthan Tiles Mh", youllGet: 29616, youllGive: 0 }] }));
    assert.equal(rows[0]?.name, "Rajasthan Tiles Mh");
    assert.equal(rows[0]?.youllGet, 29616);
  });
});

describe("khata cutover constants", () => {
  it("locks the 12 Sep 2026 totals", () => {
    assert.equal(KHATA_PARTY_COUNT, 46);
    assert.equal(KHATA_AR_TOTAL_MINOR, 1_256_124_800);
    assert.equal(KHATA_AP_TOTAL_MINOR, 16_367_100);
    assert.equal(operationalDateFor(parseFactoryDate("2026-09-12")).toISOString().slice(0, 10), "2026-09-12");
    assert.equal(operationalDateFor(parseFactoryDateInput("2026-09-12")).toISOString().slice(0, 10), "2026-09-12");
  });
});

describe("khata pdf", () => {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../test/fixtures/khata/pdf");

  it("parses the customer-list PDF to 46 parties and locked totals", () => {
    const bytes = readFileSync(path.join(dir, "customer-list.pdf"));
    const text = extractPdfText(bytes);
    assert.match(text, /Rajasthan Tiles Mh/);
    const preview = previewKhata({ fileName: "customer-list.pdf", bytes });
    assert.equal(preview.kind, "customer-list");
    assert.equal(preview.partyCount, 46);
    assert.equal(preview.arRupees, 12_561_248);
    assert.equal(preview.apRupees, 163_671);
    assert.equal(preview.totalsOk, true);
  });

  it("keeps Cash 97070 on a statement PDF as narration", () => {
    const bytes = readFileSync(path.join(dir, "shakti-statement.pdf"));
    const preview = previewKhata({ fileName: "shakti-statement.pdf", bytes });
    assert.equal(preview.kind, "statement");
    assert.ok(preview.statements.some((s) => s.cashNarration && /cash 97070/i.test(s.details)));
  });
});

describe("copilot propose-only", () => {
  it("classifies journal lines without posting", () => {
    const draft = ruleBasedDraft("CASH Dr 100\nSALES Cr 100");
    assert.equal(draft.kind, "journal");
  });
});

describe("books roles", () => {
  it("lets supervisors read statements but not import opening books or lock the drawer", () => {
    assert.doesNotThrow(() => assertAllowedRoles(BOOKS_STATEMENT_ROLES, "supervisor"));
    assert.throws(() => assertAllowedRoles(HISTORICAL_IMPORT_ROLES, "supervisor"), ForbiddenException);
    assert.throws(() => assertAllowedRoles(CASH_DRAWER_LOCK_ROLES, "supervisor"), ForbiddenException);
    assert.equal(CEO_ROLES.includes("supervisor"), false);
    assert.doesNotThrow(() => assertAllowedRoles(INTAKE_DRAFT_ROLES, "supervisor"));
  });
});
