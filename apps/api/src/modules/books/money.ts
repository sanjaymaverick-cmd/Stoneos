import { BadRequestException } from "@nestjs/common";
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

/** Today's date on the factory clock (IST), as YYYY-MM-DD. */
export function factoryToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * A business date — when money moved, a sale was made, a worker turned up — as
 * the factory records it. Nothing a yard does is dated after today: a payment
 * "received" next March is a typo, and accepting it put a year of future rows into
 * this month's figures. Invalid or future dates are refused with the field named.
 */
export function parseBusinessDate(value: string | Date, field: string, now: Date = new Date()): Date {
  const at = parseFactoryDateInput(value);
  if (Number.isNaN(at.getTime())) throw new BadRequestException(`${field} is not a valid date`);
  if (factoryToday(at) > factoryToday(now)) {
    throw new BadRequestException(`${field} cannot be after today (${factoryToday(now)})`);
  }
  return at;
}

/**
 * Rates are quoted EXCLUSIVE of GST throughout. A document's amount is therefore
 * taxable value PLUS tax — what is owed or payable.
 */

/**
 * The statutory GST slabs, as percentages. A rate outside this set is a typo or a
 * misunderstanding, never a real supply, so it is rejected rather than filed.
 * 0.25% and 3% exist for precious stones and bullion; they are listed for
 * completeness because the set is the law's, not this factory's.
 */
export const GST_RATE_SLABS = [0, 0.25, 3, 5, 12, 18, 28] as const;
export type GstRateSlab = (typeof GST_RATE_SLABS)[number];

/** Defaults by what is being traded. Every one of them is overridable per document. */
export const GST_DEFAULTS = {
  /** Polished granite slabs, HSN 6802. */
  finishedSlab: 18,
  /** Rough or unworked granite blocks, HSN 2516. */
  rawBlock: 5,
  /** Consumables, spares and services vary; 18% is the commonest, never assume it. */
  expense: 18,
} as const;

/** Kept for the finished-slab sale path, which is what the constant always meant. */
export const GST_RATE = GST_DEFAULTS.finishedSlab / 100;

export function isGstRateSlab(pct: number): pct is GstRateSlab {
  return (GST_RATE_SLABS as readonly number[]).includes(pct);
}

/**
 * Accept a rate the user chose, as a percentage. Falls back to the supplied default
 * when nothing was chosen; throws on anything that is not a statutory slab, because a
 * 15% or 8% line would sail through every downstream sum and only surface at filing.
 */
export function resolveGstRatePct(pct: number | null | undefined, fallback: number): number {
  const value = pct ?? fallback;
  if (!isGstRateSlab(value)) {
    throw new BadRequestException(
      `GST rate ${value}% is not a statutory slab. Choose one of ${GST_RATE_SLABS.join(", ")}.`,
    );
  }
  return value;
}

/**
 * The shape of a GSTIN: two state digits, a PAN, an entity code, a Z, a checksum.
 *
 * Format only — no check-digit arithmetic. Catching a typed-in 14 characters or a
 * stray space is most of the value, and a wrong GSTIN on a tax invoice is the
 * buyer's problem to spot, not something this can decide for them.
 */
export const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/;

/**
 * Normalise a typed GSTIN, or refuse it.
 *
 * Blank means "not registered", which is a legitimate answer for a counter buyer,
 * so it comes back null rather than throwing.
 */
export function cleanGstin(value: string | null | undefined, label = "GSTIN"): string | null {
  const gstin = (value ?? "").trim().toUpperCase();
  if (!gstin) return null;
  if (!GSTIN_PATTERN.test(gstin)) {
    throw new BadRequestException(
      `${label} must be 15 characters in the GST format, e.g. 08AAUFV3603N1ZH — got "${gstin}"`,
    );
  }
  return gstin;
}

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
    /** Statutory slab as a percentage (5, 12, 18 …), not a fraction. */
    ratePct?: number;
    /** What to charge when the caller supplied no rate. Callers pass their own: a
     *  rough block is 5%, a finished slab 18%. There is no sensible global default. */
    defaultRatePct?: number;
    registered?: boolean;
  },
): GstBreakdown {
  const supplierState = normaliseStateCode(opts.supplierStateCode);
  // An unidentified buyer is supplied where the factory stands: local counter sale.
  const placeOfSupply = normaliseStateCode(opts.placeOfSupplyStateCode) ?? supplierState;
  const registered = opts.registered ?? Boolean(supplierState);
  const ratePct = registered
    ? resolveGstRatePct(opts.ratePct, opts.defaultRatePct ?? GST_DEFAULTS.finishedSlab)
    : 0;
  const rate = ratePct / 100;
  const interState = Boolean(supplierState && placeOfSupply && supplierState !== placeOfSupply);

  const zero = {
    taxableMinor: Math.max(0, taxableMinor),
    cgstMinor: 0,
    sgstMinor: 0,
    igstMinor: 0,
    totalMinor: Math.max(0, taxableMinor),
    interState,
    ratePct,
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
