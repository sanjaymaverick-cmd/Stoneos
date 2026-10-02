/*
 * The daily progress report.
 *
 * Two shapes, one body of figures:
 *
 *   - a single-day workbook, the file that goes out to the partners each evening;
 *   - a running month workbook, a tab per day plus a summary, which is the copy
 *     the office keeps.
 *
 * Both are built from {@link DailyReportData}, so a number can never say one thing
 * in the partners' copy and another in ours. This module is pure: it takes figures
 * already gathered and returns sheets. Everything about *where* the figures come
 * from lives in the API service.
 *
 * Money is in whole rupees here, not paise. The ledger works in integer paise
 * because it must balance exactly; a report is read, not reconciled, and rupees
 * with two decimals is what a partner expects to see.
 */

import { blank, dec, int, text, type Cell, type Sheet } from "@stoneos/xlsx";

export interface CuttingFigures {
  /** Cutting sessions that logged a day's work. */
  machinesRunning: number;
  runtimeHours: number;
  downtimeMinutes: number;
  powerKwh: number;
  /** What the shop floor wrote down. */
  slabsProducedPerLog: number;
  /** What actually landed in stock, counted from the slab records themselves. */
  slabsAddedToStock: number;
  sqftAddedToStock: number;
  /** Slabs with no length or width recorded, so absent from the sqft above. */
  slabsMissingDimensions: number;
  blocksCompleted: number;
  damagedSlabs: number;
}

export interface PolishingFigures {
  sessions: number;
  runtimeHours: number;
  downtimeMinutes: number;
  slabsPolished: number;
  sqftPolished: number;
}

export interface InvoiceLine {
  invoiceNumber: string;
  customer: string;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

export interface CashSaleLine {
  buyer: string;
  amount: number;
}

export interface CollectionLine {
  customer: string;
  invoiceNumber: string;
  method: string;
  amount: number;
}

export interface ExpenseLine {
  category: string;
  paidTo: string;
  amount: number;
}

export interface DispatchLine {
  customer: string;
  orderReference: string;
  slabs: number;
}

/**
 * What was physically on the yard when the day ended.
 *
 * Both figures are reconstructed from dated records — when a block was received
 * and when its cutting finished, when a slab was produced and when it was
 * dispatched — so a tab for the 3rd shows the 3rd's position, not today's. There
 * is deliberately no "reserved" count here: reservation is a current state on the
 * slab row with no date attached, so it cannot be stated as at a past day.
 */
export interface ClosingStock {
  /** Blocks received on or before this day whose cutting had not yet finished. */
  blocksOnHand: number;
  /** Slabs produced on or before this day and not yet dispatched. */
  slabsOnHand: number;
}

export interface DailyReportData {
  factoryName: string;
  /** The operational day, at UTC midnight — the same value `@db.Date` columns hold. */
  date: Date;
  cutting: CuttingFigures;
  polishing: PolishingFigures;
  ordersTaken: number;
  orderSqft: number;
  orderValue: number;
  invoices: InvoiceLine[];
  cashSales: CashSaleLine[];
  collections: CollectionLine[];
  expenses: ExpenseLine[];
  dispatches: DispatchLine[];
  closingStock: ClosingStock;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** "02 Oct 2026". Used in headings, where an Excel date cell would be overkill. */
export function formatReportDate(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${day} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** "02 Oct" — short enough to read on a tab with thirty siblings. */
export function dayTabName(date: Date): string {
  return `${String(date.getUTCDate()).padStart(2, "0")} ${MONTHS[date.getUTCMonth()]}`;
}

const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

export function invoicedTotal(data: DailyReportData): number {
  return sum(data.invoices.map((i) => i.total));
}
export function cashSalesTotal(data: DailyReportData): number {
  return sum(data.cashSales.map((c) => c.amount));
}
export function collectionsTotal(data: DailyReportData): number {
  return sum(data.collections.map((c) => c.amount));
}
export function expensesTotal(data: DailyReportData): number {
  return sum(data.expenses.map((e) => e.amount));
}
export function slabsDispatched(data: DailyReportData): number {
  return sum(data.dispatches.map((d) => d.slabs));
}

const heading = (label: string): Cell[] => [text(label, true)];
const measure = (label: string, value: Cell): Cell[] => [text(label), value];

/**
 * The day sheet: the whole of a day on one page, in the order someone reads it —
 * what we made, what we sold, what came in, what went out, what is left.
 */
export function dailySheet(data: DailyReportData, tabName?: string): Sheet {
  const { cutting, polishing } = data;
  const rows: Cell[][] = [
    [text(`${data.factoryName} — Daily Progress Report`, true)],
    [text(formatReportDate(data.date), true)],
    [text("Operational day runs 07:00 to 07:00 (IST).")],
    [],

    heading("CUTTING"),
    measure("Machines running", int(cutting.machinesRunning)),
    measure("Runtime (hours)", dec(cutting.runtimeHours)),
    measure("Downtime (minutes)", int(cutting.downtimeMinutes)),
    measure("Power used (kWh)", dec(cutting.powerKwh)),
    measure("Slabs produced (shop log)", int(cutting.slabsProducedPerLog)),
    measure("Slabs added to stock", int(cutting.slabsAddedToStock)),
    measure("Sqft added to stock", dec(cutting.sqftAddedToStock)),
    measure("Slabs missing dimensions", int(cutting.slabsMissingDimensions)),
    measure("Blocks finished", int(cutting.blocksCompleted)),
    measure("Slabs damaged", int(cutting.damagedSlabs)),
    [],

    heading("POLISHING"),
    measure("Sessions", int(polishing.sessions)),
    measure("Runtime (hours)", dec(polishing.runtimeHours)),
    measure("Downtime (minutes)", int(polishing.downtimeMinutes)),
    measure("Slabs polished", int(polishing.slabsPolished)),
    measure("Sqft polished", dec(polishing.sqftPolished)),
    [],

    heading("SALES"),
    measure("Orders taken", int(data.ordersTaken)),
    measure("Order quantity (sqft)", dec(data.orderSqft)),
    measure("Order value (₹)", dec(data.orderValue)),
    measure("Invoices raised", int(data.invoices.length)),
    measure("Invoiced (₹)", dec(invoicedTotal(data))),
    measure("Cash sales (₹)", dec(cashSalesTotal(data))),
    measure("Dispatches", int(data.dispatches.length)),
    measure("Slabs dispatched", int(slabsDispatched(data))),
    [],

    heading("MONEY"),
    measure("Collected (₹)", dec(collectionsTotal(data))),
    measure("Expenses (₹)", dec(expensesTotal(data))),
    measure("Net cash movement (₹)", dec(collectionsTotal(data) - expensesTotal(data))),
    [],

    heading("STOCK AT DAY END"),
    measure("Blocks on hand", int(data.closingStock.blocksOnHand)),
    measure("Slabs on hand", int(data.closingStock.slabsOnHand)),
  ];

  appendTable(
    rows,
    "INVOICES",
    ["Invoice", "Customer", "Taxable (₹)", "CGST (₹)", "SGST (₹)", "IGST (₹)", "Total (₹)"],
    data.invoices.map((i) => [
      text(i.invoiceNumber),
      text(i.customer),
      dec(i.taxable),
      dec(i.cgst),
      dec(i.sgst),
      dec(i.igst),
      dec(i.total),
    ]),
    [blank(), text("Total", true), ...invoiceTotals(data.invoices)],
  );

  appendTable(
    rows,
    "CASH SALES",
    ["Buyer", "Amount (₹)"],
    data.cashSales.map((c) => [text(c.buyer), dec(c.amount)]),
    [text("Total", true), dec(cashSalesTotal(data), true)],
  );

  appendTable(
    rows,
    "COLLECTIONS",
    ["Customer", "Against invoice", "Method", "Amount (₹)"],
    data.collections.map((c) => [
      text(c.customer),
      text(c.invoiceNumber),
      text(c.method),
      dec(c.amount),
    ]),
    [text("Total", true), blank(), blank(), dec(collectionsTotal(data), true)],
  );

  appendTable(
    rows,
    "EXPENSES",
    ["Category", "Paid to", "Amount (₹)"],
    data.expenses.map((e) => [text(e.category), text(e.paidTo), dec(e.amount)]),
    [text("Total", true), blank(), dec(expensesTotal(data), true)],
  );

  appendTable(
    rows,
    "DISPATCHES",
    ["Customer", "Order", "Slabs"],
    data.dispatches.map((d) => [text(d.customer), text(d.orderReference), int(d.slabs)]),
    [text("Total", true), blank(), int(slabsDispatched(data), true)],
  );

  return {
    name: tabName ?? dayTabName(data.date),
    rows,
    columnWidths: [30, 24, 14, 12, 12, 12, 14],
  };
}

/** Column totals for the invoice table, in the same order as its headers. */
function invoiceTotals(invoices: readonly InvoiceLine[]): Cell[] {
  const total = (pick: (line: InvoiceLine) => number) => dec(sum(invoices.map(pick)), true);
  return [
    total((i) => i.taxable),
    total((i) => i.cgst),
    total((i) => i.sgst),
    total((i) => i.igst),
    total((i) => i.total),
  ];
}

/**
 * A titled block: heading, column headers, the rows, then a totals line.
 *
 * An empty table still gets its heading and a note. Omitting it would leave the
 * reader unable to tell "nothing happened" from "this report forgot to look".
 */
function appendTable(
  rows: Cell[][],
  title: string,
  headers: readonly string[],
  body: Cell[][],
  totals: Cell[],
): void {
  rows.push([], [text(title, true)]);
  if (body.length === 0) {
    rows.push([text("None today.")]);
    return;
  }
  rows.push(headers.map((h) => text(h, true)));
  rows.push(...body);
  rows.push(totals);
}

/** Columns of the month summary, in order. Shared by the header and each row. */
const SUMMARY_COLUMNS = [
  "Date",
  "Cut runtime (h)",
  "Slabs to stock",
  "Sqft to stock",
  "Slabs polished",
  "Sqft polished",
  "Orders",
  "Order value (₹)",
  "Invoices",
  "Invoiced (₹)",
  "Cash sales (₹)",
  "Collected (₹)",
  "Expenses (₹)",
  "Dispatches",
  "Blocks on hand",
  "Slabs on hand",
] as const;

/**
 * Index of the last column it is meaningful to add up. Everything after it is a
 * closing balance, which must not be summed.
 */
const LAST_FLOW_COLUMN_INDEX = 13;

function summaryRow(day: DailyReportData): Cell[] {
  return [
    text(formatReportDate(day.date)),
    dec(day.cutting.runtimeHours),
    int(day.cutting.slabsAddedToStock),
    dec(day.cutting.sqftAddedToStock),
    int(day.polishing.slabsPolished),
    dec(day.polishing.sqftPolished),
    int(day.ordersTaken),
    dec(day.orderValue),
    int(day.invoices.length),
    dec(invoicedTotal(day)),
    dec(cashSalesTotal(day)),
    dec(collectionsTotal(day)),
    dec(expensesTotal(day)),
    int(day.dispatches.length),
    int(day.closingStock.blocksOnHand),
    int(day.closingStock.slabsOnHand),
  ];
}

/**
 * Month to date, one line per day.
 *
 * The totals line adds the flow columns only. Stock is a closing balance: adding
 * thirty days of "slabs in stock" would produce a number that means nothing, so
 * those cells are left empty and the last day's balance is stated separately.
 */
export function monthSummarySheet(month: string, days: readonly DailyReportData[]): Sheet {
  const factoryName = days[0]?.factoryName ?? "StoneOS";
  const rows: Cell[][] = [
    [text(`${factoryName} — Daily Progress, ${month}`, true)],
    [text(`${days.length} day${days.length === 1 ? "" : "s"} recorded.`)],
    [],
    SUMMARY_COLUMNS.map((c) => text(c, true)),
  ];

  const bodyRows = days.map(summaryRow);
  rows.push(...bodyRows);

  if (days.length > 0) {
    const totals: Cell[] = [text("TOTAL", true)];
    for (let column = 1; column <= LAST_FLOW_COLUMN_INDEX; column += 1) {
      const cells = bodyRows.map((row) => row[column]);
      const isInteger = cells.some((c) => c?.kind === "number" && c.format === "integer");
      const total = sum(cells.map((c) => (c?.kind === "number" ? c.value : 0)));
      totals.push(isInteger ? int(total, true) : dec(total, true));
    }
    rows.push(totals);

    const last = days[days.length - 1]!;
    rows.push([]);
    rows.push([
      text(
        `Stock columns are closing balances and are not added up. At the end of ${formatReportDate(last.date)}: ` +
          `${last.closingStock.blocksOnHand} blocks and ${last.closingStock.slabsOnHand} slabs on hand.`,
      ),
    ]);
  }

  return {
    name: "Summary",
    rows,
    columnWidths: [14, 14, 14, 14, 14, 14, 9, 16, 10, 16, 15, 15, 15, 12, 15, 15],
    freezeRows: 4,
  };
}

/** The single-day workbook: what goes out to the partners. */
export function dailyReportSheets(data: DailyReportData): Sheet[] {
  return [{ ...dailySheet(data, formatReportDate(data.date)), freezeRows: 3 }];
}

/** The running month workbook: summary first, then a tab per day. */
export function monthlyReportSheets(month: string, days: readonly DailyReportData[]): Sheet[] {
  return [monthSummarySheet(month, days), ...days.map((day) => dailySheet(day))];
}
