/*
 * A small .xlsx writer: enough spreadsheet to put a day's figures in front of a
 * partner, and no more.
 *
 * Supports multiple sheets, text/number/date cells, bold, three number formats,
 * column widths and a frozen header. It does not support formulas, merged cells,
 * colours, charts or images — if a report ever needs those, reach for a real
 * library rather than growing this one.
 *
 * Strings are written inline rather than through a shared-string table. That costs
 * a few kilobytes on a file with repeated text and saves a whole part plus an index,
 * which is the right trade at report sizes.
 */

import { zipSync, type ZipEntry } from "./zip";

export type NumberFormat = "integer" | "decimal";

export type Cell =
  | { kind: "blank" }
  | { kind: "text"; value: string; bold?: boolean }
  | { kind: "number"; value: number; format: NumberFormat; bold?: boolean }
  | { kind: "date"; value: Date; bold?: boolean };

export const blank = (): Cell => ({ kind: "blank" });
export const text = (value: string, bold = false): Cell => ({ kind: "text", value, bold });
export const int = (value: number, bold = false): Cell => ({
  kind: "number",
  value,
  format: "integer",
  bold,
});
export const dec = (value: number, bold = false): Cell => ({
  kind: "number",
  value,
  format: "decimal",
  bold,
});
export const date = (value: Date, bold = false): Cell => ({ kind: "date", value, bold });

export interface Sheet {
  /** Shown on the tab. Sanitised and truncated to Excel's rules before writing. */
  name: string;
  rows: Cell[][];
  /** Column widths in Excel's character units, left to right. Missing ones default. */
  columnWidths?: number[];
  /** Rows to keep visible when scrolling, counted from the top. */
  freezeRows?: number;
}

/** Excel counts days from 1899-12-30. Dates are written as that serial, styled as a date. */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;

export function toExcelSerial(value: Date): number {
  return (value.getTime() - EXCEL_EPOCH_UTC) / MS_PER_DAY;
}

/*
 * Style indices into the cellXfs table built in stylesXml, in this exact order.
 * Each is a (font, number format) pair; keep the two in step.
 */
const STYLE_GENERAL = 0;
const STYLE_GENERAL_BOLD = 1;
const STYLE_INTEGER = 2;
const STYLE_INTEGER_BOLD = 3;
const STYLE_DECIMAL = 4;
const STYLE_DECIMAL_BOLD = 5;
const STYLE_DATE = 6;
const STYLE_DATE_BOLD = 7;

function styleFor(cell: Cell): number {
  switch (cell.kind) {
    case "blank":
      return STYLE_GENERAL;
    case "text":
      return cell.bold ? STYLE_GENERAL_BOLD : STYLE_GENERAL;
    case "date":
      return cell.bold ? STYLE_DATE_BOLD : STYLE_DATE;
    case "number":
      if (cell.format === "integer") return cell.bold ? STYLE_INTEGER_BOLD : STYLE_INTEGER;
      return cell.bold ? STYLE_DECIMAL_BOLD : STYLE_DECIMAL;
  }
}

export function escapeXml(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    // Characters XML 1.0 cannot represent at all, not even as a reference. They
    // reach us from pasted supplier names and would make the file unopenable.
    if (code < 0x20 && ch !== "\t" && ch !== "\n" && ch !== "\r") continue;
    if (ch === "&") out += "&amp;";
    else if (ch === "<") out += "&lt;";
    else if (ch === ">") out += "&gt;";
    else if (ch === '"') out += "&quot;";
    else if (ch === "'") out += "&apos;";
    else out += ch;
  }
  return out;
}

/** A1, B1 ... Z1, AA1. Excel's column letters are base-26 with no zero digit. */
export function cellRef(rowIndex: number, columnIndex: number): string {
  let n = columnIndex + 1;
  let letters = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - remainder) / 26);
  }
  return `${letters}${rowIndex + 1}`;
}

/**
 * Excel rejects a workbook whose tab names break its rules, and it does so with a
 * "needs repair" dialog that tells the reader nothing. Fix the name instead.
 */
export function sanitiseSheetName(name: string, fallback: string): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, "-").trim().slice(0, 31);
  return cleaned.length > 0 ? cleaned : fallback;
}

function uniqueSheetNames(sheets: readonly Sheet[]): string[] {
  const seen = new Set<string>();
  return sheets.map((sheet, index) => {
    const base = sanitiseSheetName(sheet.name, `Sheet${index + 1}`);
    if (!seen.has(base.toLowerCase())) {
      seen.add(base.toLowerCase());
      return base;
    }
    // Excel also requires names to be unique, case-insensitively.
    for (let suffix = 2; ; suffix += 1) {
      const tail = ` (${suffix})`;
      const candidate = base.slice(0, 31 - tail.length) + tail;
      if (!seen.has(candidate.toLowerCase())) {
        seen.add(candidate.toLowerCase());
        return candidate;
      }
    }
  });
}

function sheetXml(sheet: Sheet): string {
  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
  ];

  const freeze = sheet.freezeRows ?? 0;
  if (freeze > 0) {
    parts.push(
      "<sheetViews><sheetView workbookViewId=\"0\">" +
        `<pane ySplit="${freeze}" topLeftCell="A${freeze + 1}" activePane="bottomLeft" state="frozen"/>` +
        "</sheetView></sheetViews>",
    );
  }

  const widths = sheet.columnWidths ?? [];
  if (widths.length > 0) {
    const cols = widths
      .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
      .join("");
    parts.push(`<cols>${cols}</cols>`);
  }

  parts.push("<sheetData>");
  sheet.rows.forEach((row, rowIndex) => {
    const cells: string[] = [];
    row.forEach((cell, columnIndex) => {
      if (cell.kind === "blank") return;
      const ref = cellRef(rowIndex, columnIndex);
      const style = styleFor(cell);
      if (cell.kind === "text") {
        cells.push(
          `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell.value)}</t></is></c>`,
        );
      } else if (cell.kind === "number") {
        // A non-finite number has no cell representation; an empty cell reads as
        // "no figure", which is the honest rendering of NaN or Infinity.
        if (!Number.isFinite(cell.value)) return;
        cells.push(`<c r="${ref}" s="${style}"><v>${cell.value}</v></c>`);
      } else {
        cells.push(`<c r="${ref}" s="${style}"><v>${toExcelSerial(cell.value)}</v></c>`);
      }
    });
    if (cells.length === 0) return; // an empty row needs no element at all
    parts.push(`<row r="${rowIndex + 1}">${cells.join("")}</row>`);
  });
  parts.push("</sheetData></worksheet>");

  return parts.join("");
}

function stylesXml(): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="3">' +
    '<numFmt numFmtId="164" formatCode="#,##0"/>' +
    '<numFmt numFmtId="165" formatCode="#,##0.00"/>' +
    '<numFmt numFmtId="166" formatCode="dd-mmm-yyyy"/>' +
    "</numFmts>" +
    '<fonts count="2">' +
    '<font><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
    "</fonts>" +
    '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    // Order must match the STYLE_* constants above.
    '<cellXfs count="8">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
    '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="165" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
    '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="166" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
    "</cellXfs>" +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    "</styleSheet>"
  );
}

/**
 * Build a workbook. Returns the complete .xlsx file as bytes, ready to write to
 * disk or stream to a browser.
 */
export function buildWorkbook(sheets: readonly Sheet[]): Buffer {
  if (sheets.length === 0) {
    throw new RangeError("a workbook needs at least one sheet");
  }
  const names = uniqueSheetNames(sheets);

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    sheets
      .map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join("") +
    "</Types>";

  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    "</Relationships>";

  // Sheets take rId1..rIdN; styles takes the one after, so the ids never collide.
  const stylesRelId = `rId${sheets.length + 1}`;
  const workbookRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join("") +
    `<Relationship Id="${stylesRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    "</Relationships>";

  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    "<sheets>" +
    names
      .map((name, i) => `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join("") +
    "</sheets></workbook>";

  const entries: ZipEntry[] = [
    { path: "[Content_Types].xml", data: Buffer.from(contentTypes, "utf8") },
    { path: "_rels/.rels", data: Buffer.from(rootRels, "utf8") },
    { path: "xl/workbook.xml", data: Buffer.from(workbook, "utf8") },
    { path: "xl/_rels/workbook.xml.rels", data: Buffer.from(workbookRels, "utf8") },
    { path: "xl/styles.xml", data: Buffer.from(stylesXml(), "utf8") },
    ...sheets.map((sheet, i) => ({
      path: `xl/worksheets/sheet${i + 1}.xml`,
      data: Buffer.from(sheetXml(sheet), "utf8"),
    })),
  ];

  return zipSync(entries);
}
