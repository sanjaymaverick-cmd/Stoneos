/** Operational day is 07:00 to 07:00, local factory clock. */
export const OPERATIONAL_DAY_START_HOUR = 7;

export function operationalDateFor(occurredAt: Date): Date {
  const shifted = new Date(occurredAt);
  shifted.setHours(shifted.getHours() - OPERATIONAL_DAY_START_HOUR);
  return new Date(Date.UTC(shifted.getFullYear(), shifted.getMonth(), shifted.getDate()));
}

export function formatOperationalDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
