import { RECOVERY_BENCHMARK_SQFT_PER_TON } from "./recovery.ts";

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

/** Count only the fraction of block tons implied by sold sqft vs the 105 benchmark. */
export function factoryRecovery(rows: Array<{ soldSqft: number; weightTons: number }>): number | null {
  let sold = 0;
  let tons = 0;
  for (const r of rows) {
    if (r.soldSqft <= 0 || r.weightTons <= 0) continue;
    sold += r.soldSqft;
    const implied = r.soldSqft / RECOVERY_BENCHMARK_SQFT_PER_TON;
    tons += Math.min(r.weightTons, implied);
  }
  if (tons <= 0) return null;
  return sold / tons;
}
