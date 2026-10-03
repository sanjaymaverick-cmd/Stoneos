/*
 * Stock counted by the lot.
 *
 * A block is sawn into slabs of one size and the yard tracks how many are left, not
 * which ones. "VG-001 has 87 slabs" is how the floor actually talks, and nobody
 * stencils a number on every piece — so the lot carries three counts and availability
 * is derived from them:
 *
 *     available = good - broken - sold
 *
 * Derived, never stored. A stored total is a fourth number that can disagree with the
 * three movements that produced it, and when it does there is no way to tell which is
 * right. Three counts that each mean one thing cannot drift.
 */

export const HSN_FINISHED_SLAB = "6802";
export const HSN_ROUGH_BLOCK = "2516";

export interface LotCounts {
  /** Good slabs that reached stock. Pieces lost on the saw never counted. */
  goodSlabCount: number;
  /** Written off after stocking: broken in the yard, in transport, while loading. */
  brokenSlabCount: number;
  soldSlabCount: number;
  /// Been through the polishing line. Optional because most callers do not ask for
  /// it, and because it must never be mistaken for a fourth term of availability.
  polishedSlabCount?: number;
}

export function availableSlabs(lot: LotCounts): number {
  return lot.goodSlabCount - lot.brokenSlabCount - lot.soldSlabCount;
}

/**
 * How the yard names a lot: the block, then how many slabs are in it.
 *
 *     VG01-70
 *
 * One label for one lot, not seventy labels for seventy pieces. The count is the
 * live one, so the same block reads VG01-70 before a sale and VG01-20 after fifty go
 * out — which is exactly how the floor describes it, and why the count belongs in
 * the label rather than in a column beside it.
 */
export function lotLabel(serialNumber: string, slabCount: number): string {
  return `${serialNumber}-${slabCount}`;
}

/**
 * How many of this lot could still go through the polishing line.
 *
 * Slabs that broke never will, and a slab is not polished twice. Sold slabs are
 * deliberately NOT subtracted: a buyer may take rough stock, and polishing a lot
 * before the lorry comes is ordinary. So this is what remains unfinished of
 * everything the block yielded, not what is unfinished and still unsold.
 */
export function polishableSlabs(lot: LotCounts): number {
  // Never below zero. A lot polished in full and then broken into has more polished
  // than it has left — the yard's "still to polish" is none, not minus three. Found
  // by a year-long dry run, where seven lots of thirty-one read negative.
  return Math.max(0, lot.goodSlabCount - lot.brokenSlabCount - (lot.polishedSlabCount ?? 0));
}

/** Whether this many slabs of the lot can go through the line. */
export function checkSlabsPolishable(
  lot: LotCounts & { serialNumber: string },
  wanted: number,
): LotIssue | null {
  if (!Number.isInteger(wanted) || wanted <= 0) {
    return { message: `Slab count must be a whole number above zero, got ${wanted}` };
  }
  const left = polishableSlabs(lot);
  if (wanted > left) {
    return {
      message:
        `${lot.serialNumber} has ${left} unpolished slab${left === 1 ? "" : "s"}, ` +
        `so ${wanted} cannot go through`,
    };
  }
  return null;
}

/** Area of a count of slabs. Zero when the cut never recorded a slab size. */
export function lotSqft(slabCount: number, sqftPerSlab: number | null | undefined): number {
  if (sqftPerSlab === null || sqftPerSlab === undefined) return 0;
  return slabCount * sqftPerSlab;
}

/**
 * What one slab off this block cost.
 *
 * Both legs of the purchase are cost of stone: the taxable value on the bill, and any
 * cash paid outside it to an unregistered supplier. GST is excluded — it is
 * recoverable as input credit, so it was never a cost of the stone.
 *
 * Divided across the good slabs only. The pieces lost on the saw never became stock,
 * and loading their share onto nothing would understate what the survivors cost.
 */
export function costPerSlab(input: {
  purchaseTaxable: number;
  purchaseCashAmount: number;
  goodSlabCount: number;
}): number {
  if (input.goodSlabCount <= 0) return 0;
  return (input.purchaseTaxable + input.purchaseCashAmount) / input.goodSlabCount;
}

/** Good slabs from a cut: what came off the saw, less what broke on it. */
export function goodFromCut(totalSlabsCut: number, damagedAtSaw: number): number {
  return totalSlabsCut - damagedAtSaw;
}

export interface LotIssue {
  message: string;
}

/**
 * Whether this many slabs can leave the lot.
 *
 * Returns the reason rather than throwing, so the caller can decide the status code
 * and so the message can name the real numbers — "VG-001 has 12, you asked for 100"
 * is actionable on a shop floor in a way that "insufficient stock" is not.
 */
export function checkSlabsAvailable(
  lot: LotCounts & { serialNumber: string },
  wanted: number,
): LotIssue | null {
  if (!Number.isInteger(wanted) || wanted <= 0) {
    return { message: `Slab count must be a whole number above zero, got ${wanted}` };
  }
  const available = availableSlabs(lot);
  if (wanted > available) {
    return {
      message:
        `${lot.serialNumber} has ${available} slab${available === 1 ? "" : "s"} available, ` +
        `so ${wanted} cannot be taken`,
    };
  }
  return null;
}

/** A cut must account for every piece that came off the saw. */
export function checkCutCounts(totalSlabsCut: number, damagedAtSaw: number): LotIssue | null {
  if (!Number.isInteger(totalSlabsCut) || totalSlabsCut <= 0) {
    return { message: `Total slabs cut must be a whole number above zero, got ${totalSlabsCut}` };
  }
  if (!Number.isInteger(damagedAtSaw) || damagedAtSaw < 0) {
    return { message: `Damaged count must be zero or a whole number, got ${damagedAtSaw}` };
  }
  if (damagedAtSaw > totalSlabsCut) {
    return {
      message: `Cannot damage ${damagedAtSaw} slabs out of ${totalSlabsCut} cut`,
    };
  }
  return null;
}

export interface TaxGroupInput {
  hsnCode: string;
  gstRatePct: number;
  /** Taxable value in paise. The ledger is integer paise; so is this. */
  taxableMinor: number;
}

export interface TaxGroup extends TaxGroupInput {
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
}

/**
 * Group an invoice's lines into the HSN summary a tax invoice must print.
 *
 * One row per (HSN, rate). A bill may legitimately mix 18% slabs with 5% rough
 * blocks, and a single invoice-level rate cannot express that — nor can it be split
 * back apart afterwards for the return.
 *
 * `interState` decides the heads: IGST across a state border, CGST+SGST within one.
 * Tax is computed on each group's total rather than per line, so rounding happens
 * once per rate and the parts always add to the whole. Everything is in paise, and
 * CGST/SGST halve the way gstOnTaxable does it — round one half, take the other by
 * subtraction — so the two heads are exactly the tax charged even on odd paise.
 */
export function groupTaxLines(lines: readonly TaxGroupInput[], interState: boolean): TaxGroup[] {
  const groups = new Map<string, TaxGroupInput>();
  for (const line of lines) {
    const key = `${line.hsnCode}@${line.gstRatePct}`;
    const found = groups.get(key);
    if (found) found.taxableMinor += line.taxableMinor;
    else groups.set(key, { ...line });
  }

  return [...groups.values()]
    .sort((a, b) => a.hsnCode.localeCompare(b.hsnCode) || a.gstRatePct - b.gstRatePct)
    .map((group) => {
      const tax = Math.round((group.taxableMinor * group.gstRatePct) / 100);
      if (interState) {
        return { ...group, cgstMinor: 0, sgstMinor: 0, igstMinor: tax };
      }
      const cgst = Math.round(tax / 2);
      return { ...group, cgstMinor: cgst, sgstMinor: tax - cgst, igstMinor: 0 };
    });
}

export interface TaxTotals {
  taxableMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  taxMinor: number;
  totalMinor: number;
}

export function totalTax(groups: readonly TaxGroup[]): TaxTotals {
  const sum = (pick: (g: TaxGroup) => number) => groups.reduce((total, g) => total + pick(g), 0);
  const cgstMinor = sum((g) => g.cgstMinor);
  const sgstMinor = sum((g) => g.sgstMinor);
  const igstMinor = sum((g) => g.igstMinor);
  const taxableMinor = sum((g) => g.taxableMinor);
  const taxMinor = cgstMinor + sgstMinor + igstMinor;
  return {
    taxableMinor,
    cgstMinor,
    sgstMinor,
    igstMinor,
    taxMinor,
    totalMinor: taxableMinor + taxMinor,
  };
}

/** The single rate when every group shares one, else null — a mixed-rate bill. */
export function uniformRatePct(groups: readonly TaxGroup[]): number | null {
  if (groups.length === 0) return null;
  const first = groups[0]!.gstRatePct;
  return groups.every((g) => g.gstRatePct === first) ? first : null;
}
