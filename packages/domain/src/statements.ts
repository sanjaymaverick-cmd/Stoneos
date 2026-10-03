/*
 * Account statements, laid out the way the khata lays them out.
 *
 * The paper book these replace opens with an opening balance, lists one line per
 * entry with the running balance beside it, closes with a grand total, and marks
 * every balance Dr or Cr. People read these two side by side while chasing money,
 * so the shape is deliberately the familiar one rather than a better one.
 *
 * Dr means they owe us. Cr means we owe them. A bare number with no marker is the
 * single most common way to misread a statement, so nothing here prints one.
 */

import { blank, dec, text, type Cell, type Sheet } from "@stoneos/xlsx";

export interface StatementRow {
  date: string;
  details: string;
  /** How it settled: "Cash", "ICICI", "Nema". Blank when nothing moved. */
  mode: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface PartyStatement {
  partyName: string;
  from: string | null;
  to: string | null;
  openingBalance: number;
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
  rows: readonly StatementRow[];
}

/**
 * A balance as a khata writes it: the amount, then which way it points.
 *
 * Zero is "Settled" rather than "0 Dr", because a zero with a direction on it reads
 * as though something is still open.
 */
export function drCr(balance: number): string {
  if (Math.round(balance * 100) === 0) return "Settled";
  return balance > 0 ? "Dr" : "Cr";
}

/** The magnitude, since the direction is carried separately. */
export const magnitude = (balance: number): number => Math.abs(balance);

const period = (from: string | null, to: string | null): string =>
  from || to ? `${from ?? "the beginning"} to ${to ?? "today"}` : "all entries";

/** One party, every entry, with the running balance. */
export function partyStatementSheet(statement: PartyStatement): Sheet {
  const rows: Cell[][] = [
    [text(statement.partyName, true)],
    [text(`Statement · ${period(statement.from, statement.to)}`)],
    [blank()],
    [
      text("Opening balance", true),
      dec(magnitude(statement.openingBalance)),
      text(drCr(statement.openingBalance)),
      blank(),
      text("Closing balance", true),
      dec(magnitude(statement.closingBalance)),
      text(drCr(statement.closingBalance)),
    ],
    [blank()],
    [
      text("Date", true),
      text("Details", true),
      text("Paid by", true),
      text("Debit (-)", true),
      text("Credit (+)", true),
      text("Balance", true),
      text("Dr/Cr", true),
    ],
  ];
  for (const row of statement.rows) {
    rows.push([
      text(row.date),
      text(row.details),
      text(row.mode),
      dec(row.debit),
      dec(row.credit),
      dec(magnitude(row.balance)),
      text(drCr(row.balance)),
    ]);
  }
  rows.push([
    text("Grand total", true),
    blank(),
    blank(),
    dec(statement.totalDebit, true),
    dec(statement.totalCredit, true),
    dec(magnitude(statement.closingBalance), true),
    text(drCr(statement.closingBalance), true),
  ]);
  return {
    name: "Statement",
    rows,
    columnWidths: [12, 46, 14, 14, 14, 14, 7],
    freezeRows: 6,
  };
}

export interface DueRow {
  name: string;
  kind: string;
  due: number;
}

export interface DuesReport {
  receivable: readonly DueRow[];
  payable: readonly DueRow[];
  totalReceivable: number;
  totalPayable: number;
  settledParties: number;
}

function duesSheet(name: string, heading: string, note: string, rows: readonly DueRow[], total: number): Sheet {
  const out: Cell[][] = [
    [text(heading, true)],
    [text(note)],
    [blank()],
    [text("Party", true), text("Kind", true), text("Amount", true)],
  ];
  for (const row of rows) out.push([text(row.name), text(row.kind), dec(row.due)]);
  out.push([text("Total", true), blank(), dec(total, true)]);
  // A list of debts with nothing in it is worth saying out loud; an empty sheet
  // reads like the report failed.
  if (rows.length === 0) out.push([text("Nothing outstanding.")]);
  return { name, rows: out, columnWidths: [38, 14, 16], freezeRows: 4 };
}

/** Two sheets, because chasing money and scheduling payments are different jobs. */
export function duesReportSheets(report: DuesReport): Sheet[] {
  return [
    duesSheet(
      "To collect",
      "Money owed to us",
      "Sales customers with an unpaid balance, largest first.",
      report.receivable,
      report.totalReceivable,
    ),
    duesSheet(
      "To pay",
      "Money we owe",
      "Suppliers and anyone else we are short with, largest first.",
      report.payable,
      report.totalPayable,
    ),
    {
      name: "Summary",
      rows: [
        [text("Dues summary", true)],
        [blank()],
        [text("To collect", true), dec(report.totalReceivable)],
        [text("To pay", true), dec(report.totalPayable)],
        [text("Net", true), dec(report.totalReceivable - report.totalPayable, true),
         text(drCr(report.totalReceivable - report.totalPayable))],
        [blank()],
        [text("Parties owing"), dec(report.receivable.length)],
        [text("Parties owed"), dec(report.payable.length)],
        [text("Settled"), dec(report.settledParties)],
      ],
      columnWidths: [22, 18, 8],
    },
  ];
}

/** Every party's statement in one book, a tab each, for the whole year's reading. */
export function allStatementsSheets(statements: readonly PartyStatement[]): Sheet[] {
  const summary: Sheet = {
    name: "Summary",
    rows: [
      [text("Customer statements", true)],
      [blank()],
      [text("Party", true), text("Opening", true), text("Debit (-)", true),
       text("Credit (+)", true), text("Closing", true), text("Dr/Cr", true)],
      ...statements.map((s): Cell[] => [
        text(s.partyName),
        dec(magnitude(s.openingBalance)),
        dec(s.totalDebit),
        dec(s.totalCredit),
        dec(magnitude(s.closingBalance)),
        text(drCr(s.closingBalance)),
      ]),
    ],
    columnWidths: [38, 14, 14, 14, 14, 7],
    freezeRows: 3,
  };
  // Excel allows 31 characters and no duplicates; buildWorkbook sanitises, but two
  // parties whose names agree for 31 characters would still collide, so they are
  // numbered here where the original name is still known.
  const used = new Set<string>();
  const tabs = statements.map((s, i) => {
    let name = s.partyName.slice(0, 28) || `Party ${i + 1}`;
    if (used.has(name.toLowerCase())) name = `${name.slice(0, 24)} ${i + 1}`;
    used.add(name.toLowerCase());
    return { ...partyStatementSheet(s), name };
  });
  return [summary, ...tabs];
}
