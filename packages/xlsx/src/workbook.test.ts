import assert from "node:assert/strict";
import { test } from "node:test";
import { inflateRawSync } from "node:zlib";
import {
  blank,
  buildWorkbook,
  cellRef,
  date,
  dec,
  escapeXml,
  int,
  sanitiseSheetName,
  text,
  toExcelSerial,
} from "./index";
import { crc32, zipSync } from "./zip";

/**
 * Read back an archive this package produced, by walking the central directory the
 * way a real ZIP reader does. Parsing our own output rather than trusting it is the
 * point: if the offsets or sizes are wrong, this throws.
 */
function unzip(archive: Buffer): Map<string, Buffer> {
  const eocdSignature = 0x06054b50;
  let eocd = -1;
  for (let i = archive.length - 22; i >= 0; i -= 1) {
    if (archive.readUInt32LE(i) === eocdSignature) {
      eocd = i;
      break;
    }
  }
  assert.notEqual(eocd, -1, "no end-of-central-directory record");

  const count = archive.readUInt16LE(eocd + 10);
  let pointer = archive.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();

  for (let i = 0; i < count; i += 1) {
    assert.equal(archive.readUInt32LE(pointer), 0x02014b50, "bad central directory header");
    const compressedSize = archive.readUInt32LE(pointer + 20);
    const uncompressedSize = archive.readUInt32LE(pointer + 24);
    const nameLength = archive.readUInt16LE(pointer + 28);
    const extraLength = archive.readUInt16LE(pointer + 30);
    const commentLength = archive.readUInt16LE(pointer + 32);
    const localOffset = archive.readUInt32LE(pointer + 42);
    const name = archive.subarray(pointer + 46, pointer + 46 + nameLength).toString("utf8");

    assert.equal(archive.readUInt32LE(localOffset), 0x04034b50, `bad local header for ${name}`);
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const deflated = archive.subarray(dataStart, dataStart + compressedSize);
    const data = inflateRawSync(deflated);

    assert.equal(data.length, uncompressedSize, `size mismatch for ${name}`);
    assert.equal(crc32(data), archive.readUInt32LE(pointer + 16), `crc mismatch for ${name}`);
    out.set(name, data);
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return out;
}

const part = (archive: Buffer, path: string): string => {
  const found = unzip(archive).get(path);
  assert.ok(found, `missing part ${path}`);
  return found.toString("utf8");
};

test("crc32 matches the standard check vector", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  assert.equal(crc32(Buffer.alloc(0)), 0);
});

test("zipSync produces an archive that reads back intact", () => {
  const big = Buffer.from("granite ".repeat(5000));
  const archive = zipSync([
    { path: "a.txt", data: Buffer.from("hello") },
    { path: "nested/dir/b.bin", data: big },
    { path: "empty.txt", data: Buffer.alloc(0) },
  ]);
  const files = unzip(archive);
  assert.deepEqual([...files.keys()], ["a.txt", "nested/dir/b.bin", "empty.txt"]);
  assert.equal(files.get("a.txt")!.toString(), "hello");
  assert.ok(files.get("nested/dir/b.bin")!.equals(big));
  assert.equal(files.get("empty.txt")!.length, 0);
});

test("the same workbook twice produces byte-identical files", () => {
  const make = () => buildWorkbook([{ name: "S", rows: [[text("x"), int(1)]] }]);
  assert.ok(make().equals(make()), "output must not depend on the clock");
});

test("cellRef counts columns the way Excel does", () => {
  assert.equal(cellRef(0, 0), "A1");
  assert.equal(cellRef(4, 25), "Z5");
  assert.equal(cellRef(0, 26), "AA1");
  assert.equal(cellRef(0, 27), "AB1");
  assert.equal(cellRef(99, 701), "ZZ100");
  assert.equal(cellRef(0, 702), "AAA1");
});

test("toExcelSerial agrees with Excel's 1900 date system", () => {
  assert.equal(toExcelSerial(new Date(Date.UTC(1970, 0, 1))), 25569);
  assert.equal(toExcelSerial(new Date(Date.UTC(2026, 9, 2))), 46297);
});

test("escapeXml covers the five entities and drops unrepresentable control bytes", () => {
  assert.equal(escapeXml(`a&b<c>d"e'f`), "a&amp;b&lt;c&gt;d&quot;e&apos;f");
  // A NUL or bell cannot be written to XML at all, not even escaped.
  assert.equal(escapeXml("ok\u0000\u0007here"), "okhere");
  assert.equal(escapeXml("keep\tthese\nbreaks"), "keep\tthese\nbreaks");
  assert.equal(escapeXml("₹ और ग्रेनाइट"), "₹ और ग्रेनाइट");
});

test("sheet names are stripped of characters Excel rejects and capped at 31", () => {
  assert.equal(sanitiseSheetName("Sales/Oct:2026", "x"), "Sales-Oct-2026");
  assert.equal(sanitiseSheetName("a".repeat(40), "x").length, 31);
  assert.equal(sanitiseSheetName("   ", "Fallback"), "Fallback");
  assert.equal(sanitiseSheetName("[book]*?", "x"), "-book---");
});

test("duplicate tab names are made unique, case-insensitively", () => {
  const xml = part(
    buildWorkbook([
      { name: "Day", rows: [[text("a")]] },
      { name: "day", rows: [[text("b")]] },
      { name: "DAY", rows: [[text("c")]] },
    ]),
    "xl/workbook.xml",
  );
  assert.match(xml, /name="Day"/);
  assert.match(xml, /name="day \(2\)"/);
  assert.match(xml, /name="DAY \(3\)"/);
});

test("every sheet is declared in content types and related to the workbook", () => {
  const archive = buildWorkbook([
    { name: "One", rows: [[text("a")]] },
    { name: "Two", rows: [[text("b")]] },
  ]);
  const types = part(archive, "[Content_Types].xml");
  assert.ok(types.includes("/xl/worksheets/sheet1.xml"));
  assert.ok(types.includes("/xl/worksheets/sheet2.xml"));
  assert.ok(types.includes("/xl/styles.xml"));

  // Styles must not reuse a sheet's relationship id, or the sheet silently vanishes.
  const rels = part(archive, "xl/_rels/workbook.xml.rels");
  assert.match(rels, /Id="rId1"[^>]*worksheets\/sheet1\.xml/);
  assert.match(rels, /Id="rId2"[^>]*worksheets\/sheet2\.xml/);
  assert.match(rels, /Id="rId3"[^>]*styles\.xml/);

  assert.equal([...unzip(archive).keys()][0], "[Content_Types].xml", "must be the first entry");
});

test("cells carry the value and the style their kind implies", () => {
  const xml = part(
    buildWorkbook([
      {
        name: "S",
        rows: [[text("Head", true), int(42), dec(1234.5), date(new Date(Date.UTC(2026, 9, 2)))]],
      },
    ]),
    "xl/worksheets/sheet1.xml",
  );
  assert.match(xml, /<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Head<\/t><\/is><\/c>/);
  assert.match(xml, /<c r="B1" s="2"><v>42<\/v><\/c>/);
  assert.match(xml, /<c r="C1" s="4"><v>1234\.5<\/v><\/c>/);
  assert.match(xml, /<c r="D1" s="6"><v>46297<\/v><\/c>/);
});

test("blank cells and non-finite numbers leave the cell empty rather than writing junk", () => {
  const xml = part(
    buildWorkbook([
      {
        name: "S",
        rows: [
          [text("a"), blank(), dec(Number.NaN), int(Number.POSITIVE_INFINITY), text("e")],
          [],
        ],
      },
    ]),
    "xl/worksheets/sheet1.xml",
  );
  assert.match(xml, /r="A1"/);
  assert.match(xml, /r="E1"/);
  for (const ref of ["B1", "C1", "D1"]) {
    assert.ok(!xml.includes(`r="${ref}"`), `${ref} should not be written`);
  }
  // A row with nothing in it is omitted entirely; Excel infers it.
  assert.ok(!xml.includes('<row r="2">'));
});

test("column widths and a frozen header survive into the sheet", () => {
  const xml = part(
    buildWorkbook([
      { name: "S", rows: [[text("a")]], columnWidths: [30, 12], freezeRows: 2 },
    ]),
    "xl/worksheets/sheet1.xml",
  );
  assert.match(xml, /<col min="1" max="1" width="30" customWidth="1"\/>/);
  assert.match(xml, /<col min="2" max="2" width="12" customWidth="1"\/>/);
  assert.match(xml, /ySplit="2" topLeftCell="A3"/);
});

test("a workbook with no sheets is refused rather than written unopenable", () => {
  assert.throws(() => buildWorkbook([]), RangeError);
});
