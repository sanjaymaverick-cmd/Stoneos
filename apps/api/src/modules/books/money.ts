import { createHash } from "node:crypto";

export function rupeesToMinor(rupees: number): number {
  return Math.round(Number(rupees) * 100);
}

export function minorToRupees(minor: number): number {
  return Number(minor) / 100;
}

export function partyNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function shaClientOpId(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

/** 07:00 IST on the given calendar day, so operationalDateFor keeps that date. */
export function parseFactoryDate(date: string): Date {
  return new Date(`${date}T01:30:00Z`);
}

export function parseFactoryDateInput(value: string | Date): Date {
  if (value instanceof Date) return value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return parseFactoryDate(value);
  return new Date(value);
}

/** Invoice amount is the customer total. GST is split out for GSTR filing outside StoneOS. */
export const GST_RATE = 0.18;

export function gstSplitInclusive(grossMinor: number, rate = GST_RATE): { net: number; gst: number } {
  if (grossMinor <= 0) return { net: 0, gst: 0 };
  const gst = Math.round((grossMinor * rate) / (1 + rate));
  return { net: grossMinor - gst, gst };
}

export const KHATA_CUTOVER = "2026-09-12";
export const KHATA_AR_TOTAL_MINOR = 1_256_124_800;
export const KHATA_AP_TOTAL_MINOR = 16_367_100;
export const KHATA_NET_DR_MINOR = KHATA_AR_TOTAL_MINOR - KHATA_AP_TOTAL_MINOR;
export const KHATA_PARTY_COUNT = 46;
