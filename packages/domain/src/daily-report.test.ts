import assert from "node:assert/strict";
import { test } from "node:test";
import type { Cell, Sheet } from "@stoneos/xlsx";
import {
  dayTabName,
  dailyReportSheets,
  dailySheet,
  formatReportDate,
  monthSummarySheet,
  monthlyReportSheets,
  type DailyReportData,
} from "./daily-report";

function day(date: string, overrides: Partial<DailyReportData> = {}): DailyReportData {
  return {
    factoryName: "Vedam Granites",
    date: new Date(`${date}T00:00:00.000Z`),
    cutting: {
      machinesRunning: 2,
      runtimeHours: 16.5,
      downtimeMinutes: 45,
      powerKwh: 820.25,
      slabsProducedPerLog: 90,
      slabsAddedToStock: 88,
      sqftAddedToStock: 4400.5,
      slabsMissingDimensions: 0,
      blocksCompleted: 2,
      damagedSlabs: 2,
    },
    polishing: {
      sessions: 1,
      runtimeHours: 9,
      downtimeMinutes: 20,
      slabsPolished: 85,
      sqftPolished: 4250,
    },
    ordersTaken: 3,
    orderSqft: 5000,
    orderValue: 750_000,
    invoices: [
      {
        invoiceNumber: "INV-2026-00041",
        customer: "Shree Marbles",
        taxable: 100_000,
        cgst: 9_000,
        sgst: 9_000,
        igst: 0,
        total: 118_000,
      },
      {
        invoiceNumber: "INV-2026-00042",
        customer: "AP Stone House",
        taxable: 200_000,
        cgst: 0,
        sgst: 0,
        igst: 36_000,
        total: 236_000,
      },
    ],
    cashSales: [{ buyer: "Counter sale", amount: 25_000 }],
    collections: [
      {
        customer: "Shree Marbles",
        invoiceNumber: "INV-2026-00038",
        method: "neft",
        amount: 150_000,
      },
    ],
    expenses: [
      { category: "diesel", paidTo: "HP Pump", amount: 18_000 },
      { category: "wages", paidTo: "Shift A", amount: 32_000 },
    ],
    dispatches: [{ customer: "Shree Marbles", orderReference: "SO-12", slabs: 40 }],
    closingStock: { blocksOnHand: 58, slabsOnHand: 1200 },
    ...overrides,
  };
}

/** Find the row whose first cell is this label, and return it. */
function rowFor(sheet: Sheet, label: string): Cell[] {
  const found = sheet.rows.find((row) => row[0]?.kind === "text" && row[0].value === label);
  assert.ok(found, `no row labelled "${label}"`);
  return found;
}

function numberAt(sheet: Sheet, label: string, column = 1): number {
  const cell = rowFor(sheet, label)[column];
  assert.ok(cell?.kind === "number", `${label} column ${column} is not a number`);
  return cell.value;
}

test("the day sheet reports what was made, sold, collected and spent", () => {
  const sheet = dailySheet(day("2026-10-02"));
  assert.equal(numberAt(sheet, "Sqft added to stock"), 4400.5);
  assert.equal(numberAt(sheet, "Sqft polished"), 4250);
  assert.equal(numberAt(sheet, "Orders taken"), 3);
  assert.equal(numberAt(sheet, "Invoices raised"), 2);
  assert.equal(numberAt(sheet, "Invoiced (₹)"), 118_000 + 236_000);
  assert.equal(numberAt(sheet, "Cash sales (₹)"), 25_000);
  assert.equal(numberAt(sheet, "Collected (₹)"), 150_000);
  assert.equal(numberAt(sheet, "Expenses (₹)"), 50_000);
  assert.equal(numberAt(sheet, "Slabs dispatched"), 40);
  assert.equal(numberAt(sheet, "Slabs on hand"), 1200);
});

test("net cash movement is collections less expenses, and can go negative", () => {
  assert.equal(numberAt(dailySheet(day("2026-10-02")), "Net cash movement (₹)"), 100_000);
  const lean = day("2026-10-03", {
    collections: [],
    expenses: [{ category: "wages", paidTo: "Shift A", amount: 32_000 }],
  });
  assert.equal(numberAt(dailySheet(lean), "Net cash movement (₹)"), -32_000);
});

test("the invoice table totals each tax column", () => {
  const sheet = dailySheet(day("2026-10-02"));
  // This totals line starts with a blank cell, so it is found by its label in B.
  const line = sheet.rows.find((row) => row[1]?.kind === "text" && row[1].value === "Total");
  assert.ok(line, "invoice totals line missing");
  assert.equal(line[2]?.kind === "number" && line[2].value, 300_000); // taxable
  assert.equal(line[3]?.kind === "number" && line[3].value, 9_000); // cgst
  assert.equal(line[4]?.kind === "number" && line[4].value, 9_000); // sgst
  assert.equal(line[5]?.kind === "number" && line[5].value, 36_000); // igst
  assert.equal(line[6]?.kind === "number" && line[6].value, 354_000); // total
});

test("a table with nothing in it says so instead of disappearing", () => {
  const quiet = day("2026-10-04", { invoices: [], cashSales: [], collections: [], expenses: [], dispatches: [] });
  const sheet = dailySheet(quiet);
  const headings = sheet.rows
    .filter((row) => row.length === 1 && row[0]?.kind === "text")
    .map((row) => (row[0] as { value: string }).value);
  for (const title of ["INVOICES", "CASH SALES", "COLLECTIONS", "EXPENSES", "DISPATCHES"]) {
    assert.ok(headings.includes(title), `${title} heading missing`);
  }
  const noneCount = headings.filter((h) => h === "None today.").length;
  assert.equal(noneCount, 5, "every empty table should say so");
});

test("tab and heading names read the way a person writes a date", () => {
  assert.equal(dayTabName(new Date("2026-10-02T00:00:00Z")), "02 Oct");
  assert.equal(dayTabName(new Date("2026-01-31T00:00:00Z")), "31 Jan");
  assert.equal(formatReportDate(new Date("2026-10-02T00:00:00Z")), "02 Oct 2026");
});

test("the month summary adds up the flows", () => {
  const days = [day("2026-10-01"), day("2026-10-02"), day("2026-10-03")];
  const sheet = monthSummarySheet("2026-10", days);
  const totals = rowFor(sheet, "TOTAL");
  assert.equal(totals[2]?.kind === "number" && totals[2].value, 88 * 3); // slabs to stock
  assert.equal(totals[3]?.kind === "number" && totals[3].value, 4400.5 * 3); // sqft to stock
  assert.equal(totals[9]?.kind === "number" && totals[9].value, 354_000 * 3); // invoiced
  assert.equal(totals[12]?.kind === "number" && totals[12].value, 50_000 * 3); // expenses
});

test("closing stock is never added up across days", () => {
  const days = [day("2026-10-01"), day("2026-10-02")];
  const sheet = monthSummarySheet("2026-10", days);
  const totals = rowFor(sheet, "TOTAL");
  // Columns 14 and 15 are balances. Summing them would read 116 blocks and 2400
  // slabs, which the factory does not have.
  assert.equal(totals[14], undefined, "blocks in stock must not be totalled");
  assert.equal(totals[15], undefined, "slabs in stock must not be totalled");
  const note = sheet.rows.find(
    (row) => row[0]?.kind === "text" && row[0].value.startsWith("Stock columns are closing balances"),
  );
  assert.ok(note, "the summary must explain why those columns are blank");
  assert.match((note[0] as { value: string }).value, /58 blocks and 1200 slabs on hand/);
});

test("an empty month produces a summary with no totals line rather than zeroes", () => {
  const sheet = monthSummarySheet("2026-11", []);
  assert.equal(
    sheet.rows.find((row) => row[0]?.kind === "text" && row[0].value === "TOTAL"),
    undefined,
  );
  assert.ok(sheet.rows.some((row) => row[0]?.kind === "text" && row[0].value === "0 days recorded."));
});

test("the month workbook is a summary followed by one tab per day", () => {
  const days = [day("2026-10-01"), day("2026-10-02"), day("2026-10-03")];
  const sheets = monthlyReportSheets("2026-10", days);
  assert.deepEqual(
    sheets.map((s) => s.name),
    ["Summary", "01 Oct", "02 Oct", "03 Oct"],
  );
});

test("the partner workbook is the one day, named by its date", () => {
  const sheets = dailyReportSheets(day("2026-10-02"));
  assert.equal(sheets.length, 1);
  assert.equal(sheets[0]!.name, "02 Oct 2026");
  assert.equal(sheets[0]!.freezeRows, 3);
});
