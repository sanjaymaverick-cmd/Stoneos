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

/**
 * Sale rates are quoted EXCLUSIVE of GST. Polished granite slabs are 18% (HSN 6802).
 * Invoice.amount is therefore taxable value PLUS tax — what the customer owes.
 */
export const GST_RATE = 0.18;

/** A GSTIN carries the supplying state in its first two characters. */
export function stateCodeFromGstin(gstin: string): string | null {
  const m = gstin.trim().match(/^(\d{2})/);
  return m ? m[1]! : null;
}

/** "8" and "08" are the same state. Compare normalised, never raw. */
export function normaliseStateCode(code: string | null | undefined): string | null {
  const t = (code ?? "").trim();
  if (!/^\d{1,2}$/.test(t)) return null;
  return t.padStart(2, "0");
}

export type GstBreakdown = {
  taxableMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  totalMinor: number;
  interState: boolean;
  ratePct: number;
  placeOfSupply: string | null;
  supplierState: string | null;
};

/**
 * GST on a value that already excludes tax.
 *
 * Place of supply decides the heads, not the customer's billing address: same state
 * as the supplier splits the rate into CGST and SGST, a different state charges the
 * whole rate as IGST. A factory with no GST profile charges nothing — it is not
 * registered, and guessing a rate would put a fictional liability in the books.
 */
export function gstOnTaxable(
  taxableMinor: number,
  opts: {
    supplierStateCode?: string | null;
    placeOfSupplyStateCode?: string | null;
    rate?: number;
    registered?: boolean;
  },
): GstBreakdown {
  const supplierState = normaliseStateCode(opts.supplierStateCode);
  // An unidentified buyer is supplied where the factory stands: local counter sale.
  const placeOfSupply = normaliseStateCode(opts.placeOfSupplyStateCode) ?? supplierState;
  const registered = opts.registered ?? Boolean(supplierState);
  const rate = registered ? (opts.rate ?? GST_RATE) : 0;
  const interState = Boolean(supplierState && placeOfSupply && supplierState !== placeOfSupply);

  const zero = {
    taxableMinor: Math.max(0, taxableMinor),
    cgstMinor: 0,
    sgstMinor: 0,
    igstMinor: 0,
    totalMinor: Math.max(0, taxableMinor),
    interState,
    ratePct: rate * 100,
    placeOfSupply,
    supplierState,
  };
  if (taxableMinor <= 0 || rate <= 0) return zero;

  const tax = Math.round(taxableMinor * rate);
  if (interState) {
    return { ...zero, igstMinor: tax, totalMinor: taxableMinor + tax };
  }
  // Halve once and take the other half by subtraction, so CGST + SGST is exactly the
  // tax charged even when the total is an odd number of paise.
  const cgst = Math.round(tax / 2);
  return {
    ...zero,
    cgstMinor: cgst,
    sgstMinor: tax - cgst,
    totalMinor: taxableMinor + tax,
  };
}

export const KHATA_CUTOVER = "2026-09-12";
export const KHATA_AR_TOTAL_MINOR = 1_256_124_800;
export const KHATA_AP_TOTAL_MINOR = 16_367_100;
export const KHATA_NET_DR_MINOR = KHATA_AR_TOTAL_MINOR - KHATA_AP_TOTAL_MINOR;
export const KHATA_PARTY_COUNT = 46;
