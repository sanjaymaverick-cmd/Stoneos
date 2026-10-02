import assert from "node:assert/strict";
import { describe, it, test } from "node:test";
import { damagedCostAtRawBlock, recoveryRatio, RECOVERY_BENCHMARK_SQFT_PER_TON } from "./recovery.ts";
import { damagedSlabCount, slabSerial } from "./serials.ts";
import {
  calendarMonthUtcRange,
  factoryMonthStart,
  formatCreditNoteNumber,
  formatInvoiceNumber,
  indianFinancialYear,
  operationalDateFor,
  operationalDayWindow,
  operationalDaysInMonth,
  parseOperationalDate,
} from "./operational-day.ts";

describe("slab serials", () => {
  it("formats good-slab serials from block and cut count", () => {
    assert.equal(slabSerial("V101", 50, 1), "V101/50/01");
    assert.equal(slabSerial("V101", 50, 47), "V101/50/47");
  });

  it("tracks damaged pieces as a count, not inventory rows", () => {
    assert.equal(damagedSlabCount(50, 47), 3);
  });
});

describe("recovery", () => {
  it("uses sale-time sqft per ton against the 105 benchmark", () => {
    assert.equal(recoveryRatio(210, 2), 105);
    assert.equal(RECOVERY_BENCHMARK_SQFT_PER_TON, 105);
  });

  it("values damage at raw-block cost, never finished price", () => {
    assert.equal(damagedCostAtRawBlock(50, 5, 100000), 10000);
  });
});

describe("operational day", () => {
  it("maps 06:59 IST (01:29Z) to the previous calendar date", () => {
    const d = operationalDateFor(new Date("2026-09-06T01:29:00Z"), "Asia/Kolkata");
    assert.equal(d.toISOString().slice(0, 10), "2026-09-05");
  });

  it("maps 08:00 IST (02:30Z) to the same calendar date", () => {
    const d = operationalDateFor(new Date("2026-09-06T02:30:00Z"), "Asia/Kolkata");
    assert.equal(d.toISOString().slice(0, 10), "2026-09-06");
  });

  it("maps 07:00 IST (01:30Z) to that calendar date", () => {
    const d = operationalDateFor(new Date("2026-09-06T01:30:00Z"), "Asia/Kolkata");
    assert.equal(d.toISOString().slice(0, 10), "2026-09-06");
  });

  it("starts the IST month at 18:30Z on the previous UTC day", () => {
    const start = factoryMonthStart(new Date("2026-09-06T02:30:00Z"), "Asia/Kolkata");
    assert.equal(start.toISOString(), "2026-08-31T18:30:00.000Z");
  });

  it("uses IST April–March for the invoice financial year", () => {
    assert.equal(indianFinancialYear(new Date("2026-04-01T00:00:00+05:30")), 2026);
    assert.equal(indianFinancialYear(new Date("2026-03-31T12:00:00+05:30")), 2025);
    assert.equal(indianFinancialYear(new Date("2027-03-31T23:59:00+05:30")), 2026);
    assert.equal(formatInvoiceNumber(2026, 1), "INV-2026-00001");
    assert.equal(formatCreditNoteNumber(2026, 12), "CN-2026-00012");
  });
});

describe("calendarMonthUtcRange", () => {
  it("bounds a month on calendar dates, so the last day is inside it", () => {
    const { start, end } = calendarMonthUtcRange("2026-09");
    assert.equal(start.toISOString(), "2026-09-01T00:00:00.000Z");
    assert.equal(end.toISOString(), "2026-10-01T00:00:00.000Z");

    // The regression. A DATE column reads back at UTC midnight, so a voucher on the
    // 30th is 2026-09-30T00:00:00Z. The old instant-based end (00:00 IST = 18:30 UTC
    // on the 30th) was truncated to the date 2026-09-30 by Postgres and excluded it,
    // silently dropping every last-day invoice from that month's GST output.
    const lastDay = new Date("2026-09-30T00:00:00.000Z");
    assert.ok(lastDay >= start && lastDay < end, "the 30th belongs to September");

    const firstDay = new Date("2026-09-01T00:00:00.000Z");
    assert.ok(firstDay >= start && firstDay < end, "so does the 1st");

    const nextMonth = new Date("2026-10-01T00:00:00.000Z");
    assert.ok(!(nextMonth < end), "and the 1st of October does not");
  });

  it("rolls the year over in December and rejects junk", () => {
    const december = calendarMonthUtcRange("2026-12");
    assert.equal(december.end.toISOString(), "2027-01-01T00:00:00.000Z");
    const january = calendarMonthUtcRange("2027-01");
    assert.equal(january.start.toISOString(), "2027-01-01T00:00:00.000Z");
    assert.throws(() => calendarMonthUtcRange("2026-9"), RangeError);
    assert.throws(() => calendarMonthUtcRange("september"), RangeError);
    // A month outside 01-12 must not roll silently into the neighbouring year.
    assert.throws(() => calendarMonthUtcRange("2026-13"), RangeError);
    assert.throws(() => calendarMonthUtcRange("2026-00"), RangeError);
    assert.throws(() => operationalDaysInMonth("2026-13"), RangeError);
  });

  it("covers every last day of 2026, including February", () => {
    for (let month = 1; month <= 12; month += 1) {
      const key = `2026-${String(month).padStart(2, "0")}`;
      const { start, end } = calendarMonthUtcRange(key);
      const lastDay = new Date(end.getTime() - 24 * 3600 * 1000);
      assert.ok(lastDay >= start && lastDay < end, `${key} must contain ${lastDay.toISOString()}`);
    }
  });
});

test("an operational day window is the inverse of the date it belongs to", () => {
  const date = new Date(Date.UTC(2026, 9, 2));
  const { start, end } = operationalDayWindow(date);

  // 07:00 IST on the 2nd is 01:30 UTC on the 2nd.
  assert.equal(start.toISOString(), "2026-10-02T01:30:00.000Z");
  assert.equal(end.toISOString(), "2026-10-03T01:30:00.000Z");

  // Every instant in the window must map back to the day it came from, and the
  // instants either side must not.
  assert.equal(operationalDateFor(start).getTime(), date.getTime());
  assert.equal(operationalDateFor(new Date(end.getTime() - 1)).getTime(), date.getTime());
  assert.notEqual(operationalDateFor(new Date(start.getTime() - 1)).getTime(), date.getTime());
  assert.equal(operationalDateFor(end).getTime(), new Date(Date.UTC(2026, 9, 3)).getTime());
});

test("the window covers the night shift that runs past midnight", () => {
  const date = new Date(Date.UTC(2026, 9, 2));
  const { start, end } = operationalDayWindow(date);
  // 02:00 IST on the 3rd is still the 2nd's shift.
  const nightShift = new Date("2026-10-02T20:30:00.000Z");
  assert.ok(nightShift >= start && nightShift < end);
  assert.equal(operationalDateFor(nightShift).getTime(), date.getTime());
});

test("parseOperationalDate accepts a real date and refuses anything else", () => {
  assert.equal(parseOperationalDate("2026-10-02").toISOString(), "2026-10-02T00:00:00.000Z");
  assert.equal(parseOperationalDate("2024-02-29").toISOString(), "2024-02-29T00:00:00.000Z");
  for (const bad of ["2026-02-31", "2026-13-01", "2026-1-1", "02-10-2026", "", "today", "2026-00-10"]) {
    assert.throws(() => parseOperationalDate(bad), RangeError, `should reject ${bad}`);
  }
});

test("operationalDaysInMonth lists each day once, including a leap day", () => {
  const october = operationalDaysInMonth("2026-10");
  assert.equal(october.length, 31);
  assert.equal(october[0]!.toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(october[30]!.toISOString(), "2026-10-31T00:00:00.000Z");
  assert.equal(operationalDaysInMonth("2024-02").length, 29);
  assert.equal(operationalDaysInMonth("2026-02").length, 28);
});
