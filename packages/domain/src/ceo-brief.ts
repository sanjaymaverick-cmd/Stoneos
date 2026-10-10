import { RECOVERY_BENCHMARK_SQFT_PER_TON } from "./recovery";

export type CeoExceptionSeverity = "info" | "warn" | "critical";

export type CeoException = {
  code: string;
  severity: CeoExceptionSeverity;
  message: string;
};

export type CeoBriefInput = {
  operatingStatus: string;
  recoveryRatio: number | null;
  outstandingAr: number;
  invoicedMtd: number;
  collectedMtd: number;
  expensesMtd: number;
  maintenanceDue: number;
  openCutting: number;
  blocksOnHand: number;
  slabsOnHand: number;
  /** Cash counter sales this month that carry no invoice and no GST document. */
  unbilledCashMtd?: number;
  /** Historical ledger-sale revenue; no generated invoice is implied. */
  ledgerSalesMtd?: number;
  /** Blocks whose recovery is still undecided. Drives RECOVERY_NOT_MEASURABLE. */
  openBlocks?: number;
  /** Blocks the recovery ratio is measured over. */
  settledBlocks?: number;
};

export const CEO_RECOVERY_WARN_BELOW = RECOVERY_BENCHMARK_SQFT_PER_TON;
export const CEO_AR_WARN = 500_000;
export const CEO_AR_CRITICAL = 2_000_000;

export function ceoExceptions(input: CeoBriefInput): CeoException[] {
  const out: CeoException[] = [];
  if (input.operatingStatus !== "LIVE") {
    out.push({
      code: "FACTORY_NOT_LIVE",
      severity: "warn",
      message: `Factory is ${input.operatingStatus}. Opening count is not approved; commercial totals are not books-closed.`,
    });
  }
  if (input.recoveryRatio !== null && input.recoveryRatio < CEO_RECOVERY_WARN_BELOW) {
    out.push({
      code: "RECOVERY_BELOW_BENCHMARK",
      severity: input.recoveryRatio < 90 ? "critical" : "warn",
      message: `Sale-time recovery ${input.recoveryRatio.toFixed(1)} sqft/ton is below the 105 benchmark.`,
    });
  }
  if (input.recoveryRatio === null && (input.openBlocks ?? 0) > 0) {
    out.push({
      code: "RECOVERY_NOT_MEASURABLE",
      severity: "info",
      message: `No block has sold out yet. Recovery is undecided on ${input.openBlocks} block(s); the figure is withheld rather than estimated.`,
    });
  }
  if (input.outstandingAr < 0) {
    out.push({
      code: "OVERCOLLECTED",
      severity: "critical",
      message: `Collections exceed invoiced by ₹${Math.round(-input.outstandingAr).toLocaleString("en-IN")}. Do not hide this as zero AR.`,
    });
  } else if (input.outstandingAr >= CEO_AR_CRITICAL) {
    out.push({
      code: "AR_CRITICAL",
      severity: "critical",
      message: `Outstanding collections ₹${Math.round(input.outstandingAr).toLocaleString("en-IN")} need owner follow-up.`,
    });
  } else if (input.outstandingAr >= CEO_AR_WARN) {
    out.push({
      code: "AR_ELEVATED",
      severity: "warn",
      message: `Outstanding collections ₹${Math.round(input.outstandingAr).toLocaleString("en-IN")}.`,
    });
  }
  if ((input.unbilledCashMtd ?? 0) > 0) {
    const share = input.invoicedMtd > 0
      ? (input.unbilledCashMtd! / (input.invoicedMtd + input.unbilledCashMtd!)) * 100
      : 100;
    out.push({
      code: "UNBILLED_CASH_SALES",
      severity: share >= 25 ? "warn" : "info",
      message: `₹${Math.round(input.unbilledCashMtd!).toLocaleString("en-IN")} of cash sales this month carry no invoice (${share.toFixed(0)}% of turnover). They are outside GSTR-1; the tax on a taxable supply is still due.`,
    });
  }
  if (input.maintenanceDue > 0) {
    out.push({
      code: "MAINTENANCE_DUE",
      severity: input.maintenanceDue >= 3 ? "warn" : "info",
      message: `${input.maintenanceDue} maintenance job(s) due within 7 days.`,
    });
  }
  if (input.openCutting > 5) {
    out.push({
      code: "CUTTING_WIP_HIGH",
      severity: "info",
      message: `${input.openCutting} cutting sessions still in progress.`,
    });
  }
  if (input.slabsOnHand === 0 && input.blocksOnHand === 0 && input.operatingStatus === "LIVE") {
    out.push({
      code: "EMPTY_YARD",
      severity: "warn",
      message: "LIVE factory has no blocks or slabs on hand.",
    });
  }
  if (input.expensesMtd > input.collectedMtd && input.collectedMtd > 0) {
    out.push({
      code: "EXPENSE_OVER_COLLECTIONS",
      severity: "info",
      message: "Month-to-date expenses exceed collections.",
    });
  }
  return out;
}

export type BlockRecoveryInput = {
  /** Sqft committed to customers from this block (reserved counts as sold). */
  soldSqft: number;
  /** Parent block tonnage. The whole of it, never a fraction implied by the benchmark. */
  weightTons: number;
  /** Good slabs produced from this block. Zero means the block was never cut. */
  slabCount: number;
  /** Slabs from this block still available to sell. Zero means the block is settled. */
  unsoldSlabCount: number;
};

export type FactoryRecovery = {
  /** Sqft per ton over settled blocks only. Null when no block has settled. */
  ratio: number | null;
  /** Blocks whose slabs are all committed, so their full tonnage is judged. */
  settledBlocks: number;
  /** Blocks still holding sellable slabs. Excluded: their recovery is not yet decided. */
  openBlocks: number;
  soldSqft: number;
  tons: number;
};

/**
 * Recovery over settled blocks only.
 *
 * A block counts once every slab cut from it is committed to a customer. Until then
 * its recovery is undecided and it is excluded outright — it is never folded in at a
 * discounted tonnage, because any such discount puts a floor under the ratio and hides
 * exactly the under-recovery this metric exists to expose.
 */
export function factoryRecovery(rows: BlockRecoveryInput[]): FactoryRecovery {
  let soldSqft = 0;
  let tons = 0;
  let settledBlocks = 0;
  let openBlocks = 0;
  for (const r of rows) {
    if (r.weightTons <= 0 || r.slabCount <= 0) continue;
    if (r.unsoldSlabCount > 0) {
      openBlocks += 1;
      continue;
    }
    settledBlocks += 1;
    soldSqft += r.soldSqft;
    tons += r.weightTons;
  }
  return {
    ratio: tons > 0 ? soldSqft / tons : null,
    settledBlocks,
    openBlocks,
    soldSqft,
    tons,
  };
}
