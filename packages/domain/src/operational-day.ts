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
