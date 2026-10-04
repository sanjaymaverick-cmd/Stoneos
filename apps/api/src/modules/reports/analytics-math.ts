import { factoryToday } from "../books/money";
/** Money calculations use integer paise; ratios are rounded only for presentation. */
export const minor = (v: unknown) => Math.round(Number(v ?? 0) * 100);
export const rupees = (v: number) => v / 100;
export const num = (v: unknown) => Number(v ?? 0);
export const day = (v: Date | string) => new Date(v).toISOString().slice(0, 10);
export const between = (v: Date | string, from: string, to: string) =>
  day(v) >= from && day(v) <= to;
export const daysBetween = (a: string, b: string) =>
  Math.floor((Date.parse(b) - Date.parse(a)) / 86400000);
export function ageingBucket(age: number) {
  return age <= 30 ? "0–30" : age <= 60 ? "31–60" : age <= 90 ? "61–90" : "90+";
}
export function invoiceBalance(
  invoice: {
    amount: unknown;
    payments: Array<{ amount: unknown; paidAt: Date | string }>;
    creditNotes: Array<{ amount: unknown; createdAt: Date | string }>;
  },
  asOf: string,
) {
  return Math.max(
    0,
    minor(invoice.amount) -
      invoice.payments
        .filter((p) => day(p.paidAt) <= asOf)
        .reduce((n, p) => n + minor(p.amount), 0) -
      invoice.creditNotes
        .filter((c) => factoryToday(new Date(c.createdAt)) <= asOf)
        .reduce((n, c) => n + minor(c.amount), 0),
  );
}
export function allocationShares(total: number, weights: number[]) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum) return weights.map(() => 0);
  const result = weights.map((w) => Math.floor((total * w) / sum));
  const remainders = weights
    .map((w, i) => ({ i, r: (total * w) / sum - result[i]! }))
    .sort((a, b) => b.r - a.r || a.i - b.i);
  let left = total - result.reduce((a, b) => a + b, 0);
  for (let i = 0; i < left; i++)
    result[remainders[i % remainders.length]!.i]!++;
  return result;
}
export function baselineForecast(
  months: Array<{ month: string; collections: number; soldSqft: number }>,
  firstActivity: string | null,
  lastComplete: string,
) {
  const eligible = months.filter(
    (m) =>
      m.month <= lastComplete &&
      firstActivity &&
      m.month > firstActivity.slice(0, 7),
  );
  if (eligible.length < 3)
    return {
      ready: false,
      historyMonths: eligible.length,
      reason:
        "At least three complete months after the first recorded activity are needed.",
    };
  const sample = eligible.slice(-3);
  const values = sample.map((m) => m.collections);
  const area = sample.map((m) => m.soldSqft);
  return {
    ready: true,
    historyMonths: eligible.length,
    basis: sample.map((m) => m.month),
    collections: {
      baseline: Math.round((values.reduce((a, b) => a + b, 0) / 3) * 100) / 100,
      lower: Math.min(...values),
      upper: Math.max(...values),
    },
    soldSqft: {
      baseline: Math.round((area.reduce((a, b) => a + b, 0) / 3) * 100) / 100,
      lower: Math.min(...area),
      upper: Math.max(...area),
    },
    reason:
      "Three-month average; low/high are historical scenarios, not statistical confidence intervals or payment guarantees.",
  };
}
export function equipmentMetrics(
  runtime: number,
  downtime: number,
  good: number,
  total: number,
  plannedHours: number | null,
  idealRate: number | null,
  recordedDays: number,
) {
  const availability =
    plannedHours && recordedDays
      ? runtime / (plannedHours * recordedDays)
      : null;
  const performance =
    idealRate && runtime > 0 ? total / (runtime * idealRate) : null;
  const quality = total > 0 ? good / total : null;
  const reliable =
    availability !== null &&
    performance !== null &&
    quality !== null &&
    availability <= 1 &&
    performance <= 1;
  return {
    runtimeHours: runtime,
    downtimeMinutes: downtime,
    goodSqft: good,
    sqftPerHour: runtime > 0 ? good / runtime : null,
    availability,
    performance,
    quality,
    oee: reliable ? availability! * performance! * quality! : null,
    recordedDays,
    note: reliable
      ? "Based on recorded days and configured machine standard."
      : "OEE needs planned time, a realistic production standard and quality output; values above 100% require reviewing the inputs.",
  };
}
