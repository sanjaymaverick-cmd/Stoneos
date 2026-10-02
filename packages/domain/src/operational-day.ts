/** Operational day is 07:00 to 07:00 on the factory clock (Asia/Kolkata unless overridden). */
export const OPERATIONAL_DAY_START_HOUR = 7;
export const FACTORY_TIME_ZONE = "Asia/Kolkata";

function zoneParts(occurredAt: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(occurredAt);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: n("year"), month: n("month"), day: n("day"), hour: n("hour") };
}

export function operationalDateFor(occurredAt: Date, timeZone = FACTORY_TIME_ZONE): Date {
  const z = zoneParts(occurredAt, timeZone);
  let { year, month, day } = z;
  if (z.hour < OPERATIONAL_DAY_START_HOUR) {
    const prev = new Date(Date.UTC(year, month - 1, day, 12) - 24 * 3600 * 1000);
    const p = zoneParts(prev, timeZone);
    year = p.year;
    month = p.month;
    day = p.day;
  }
  return new Date(Date.UTC(year, month - 1, day));
}

export function formatOperationalDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** India keeps UTC+5:30 all year; there is no daylight saving to account for. */
const IST_OFFSET_MS = 5.5 * 3600 * 1000;
const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The instants an operational day spans, given the day itself.
 *
 * The inverse of {@link operationalDateFor}: feed it a `@db.Date` value — UTC
 * midnight, as Postgres hands date columns back — and it returns the half-open
 * window `[07:00 IST that day, 07:00 IST the next)`.
 *
 * Needed because a day's records are split across two kinds of column. Date
 * columns (an expense, a payment) match the day directly; timestamp columns (a
 * slab's creation, a dispatch) have to be compared against this window. Using
 * UTC midnight for the latter would attribute the 05:30-to-07:00 IST hours of
 * the early shift to the wrong day.
 *
 * Assumes a fixed-offset factory clock, which Asia/Kolkata is.
 */
export function operationalDayWindow(operationalDate: Date): { start: Date; end: Date } {
  const localMidnight = operationalDate.getTime() - IST_OFFSET_MS;
  const start = localMidnight + OPERATIONAL_DAY_START_HOUR * HOUR_MS;
  return { start: new Date(start), end: new Date(start + DAY_MS) };
}

/**
 * Parse a YYYY-MM-DD request parameter into the UTC-midnight Date that `@db.Date`
 * columns hold. Rejects anything else, including a real-looking 31 February.
 */
export function parseOperationalDate(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) throw new RangeError(`date must be YYYY-MM-DD, got ${value}`);
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new RangeError(`${value} is not a real date`);
  }
  return parsed;
}

/** Every operational day in a YYYY-MM month, in order. */
export function operationalDaysInMonth(month: string): Date[] {
  const { start, end } = calendarMonthUtcRange(month);
  const days: Date[] = [];
  for (let t = start.getTime(); t < end.getTime(); t += DAY_MS) days.push(new Date(t));
  return days;
}

/** First instant of the calendar month on the factory clock, as a Date. */
export function factoryMonthStart(occurredAt: Date, timeZone = FACTORY_TIME_ZONE): Date {
  const z = zoneParts(occurredAt, timeZone);
  return new Date(Date.UTC(z.year, z.month - 1, 1) - 5.5 * 3600 * 1000);
}

/**
 * Half-open month window for a **date-only** column (`@db.Date`), as YYYY-MM.
 *
 * {@link factoryMonthStart} returns a UTC *instant* — 00:00 IST, which is 18:30 UTC on
 * the previous day. That is right for a timestamp column and wrong for a date one:
 * Postgres truncates the bound to a date, so an exclusive end of "30 Sep 18:30 UTC"
 * becomes "30 Sep" and drops everything recorded on the 30th. Monthly GST output
 * silently lost every invoice raised on the last day of the month.
 *
 * Date columns are stored and read back at UTC midnight, so the boundaries must be
 * plain calendar dates too.
 */
export function calendarMonthUtcRange(month: string): { start: Date; end: Date } {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new RangeError(`month must be YYYY-MM, got ${month}`);
  const year = Number(m[1]);
  const monthIndex = Number(m[2]) - 1;
  // Without this, "2026-13" rolls into January 2027 and "2026-00" into December
  // 2025 — both silently, and a GST return would be filed for the wrong month.
  if (monthIndex < 0 || monthIndex > 11) {
    throw new RangeError(`month must be 01-12, got ${m[2]}`);
  }
  return {
    start: new Date(Date.UTC(year, monthIndex, 1)),
    end: new Date(Date.UTC(year, monthIndex + 1, 1)),
  };
}

/**
 * Indian financial year on the factory clock: 1 April–31 March.
 * Returns the calendar year in which that FY starts (FY 2026 = 2026-04-01 .. 2027-03-31 IST).
 */
export function indianFinancialYear(occurredAt: Date, timeZone = FACTORY_TIME_ZONE): number {
  const z = zoneParts(occurredAt, timeZone);
  return z.month >= 4 ? z.year : z.year - 1;
}

export function formatInvoiceNumber(fiscalYear: number, seq: number): string {
  return `INV-${fiscalYear}-${String(seq).padStart(5, "0")}`;
}

export function formatCreditNoteNumber(fiscalYear: number, seq: number): string {
  return `CN-${fiscalYear}-${String(seq).padStart(5, "0")}`;
}
