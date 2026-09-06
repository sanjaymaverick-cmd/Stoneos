import { ceoExceptions, type CeoBriefInput, type CeoException } from "./ceo-brief.ts";

export type CeoSnapshot = CeoBriefInput & {
  factoryName: string;
  invoicedTotal: number;
  collectedTotal: number;
  damagedCost: number;
  openPolishing: number;
  openOrders: number;
};

function inr(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export function ceoNarrative(snap: CeoSnapshot, exceptions: CeoException[]): string {
  const recovery =
    snap.recoveryRatio === null
      ? "Sale-time recovery has no sold tons yet."
      : `Sale-time recovery is ${snap.recoveryRatio.toFixed(1)} sqft/ton against the 105 benchmark.`;
  const cash = `Invoiced this month ${inr(snap.invoicedMtd)}; collected ${inr(snap.collectedMtd)}; outstanding AR ${inr(snap.outstandingAr)}.`;
  const yard = `Yard: ${snap.blocksOnHand} blocks and ${snap.slabsOnHand} slabs on hand. Cutting WIP ${snap.openCutting}, polish WIP ${snap.openPolishing}, confirmed orders ${snap.openOrders}.`;
  const head =
    exceptions[0]?.severity === "critical"
      ? `Priority: ${exceptions[0].message}`
      : exceptions[0]
        ? `Watch: ${exceptions[0].message}`
        : `${snap.factoryName} is ${snap.operatingStatus} with no rule exceptions.`;
  return `${head} ${recovery} ${cash} ${yard} Damaged cost at raw-block rate ${inr(snap.damagedCost)}. Month expenses ${inr(snap.expensesMtd)}.`;
}

export function answerCeoQuestion(question: string, snap: CeoSnapshot): { answer: string; topic: string } {
  const q = question.trim().toLowerCase();
  const exceptions = ceoExceptions(snap);
  if (!q) return { answer: ceoNarrative(snap, exceptions), topic: "brief" };

  const hit = (words: string[]) => words.some((w) => q.includes(w));

  if (hit(["recover", "yield", "sqft", "ton", "105"])) {
    return {
      topic: "recovery",
      answer:
        snap.recoveryRatio === null
          ? "No sold square feet against parent-block tons yet. Recovery is sale-time only; cutting dimensions are not used."
          : `Factory recovery is ${snap.recoveryRatio.toFixed(1)} sqft/ton. Benchmark is 105. ${exceptions.find((e) => e.code === "RECOVERY_BELOW_BENCHMARK")?.message ?? "At or above benchmark."}`,
    };
  }
  if (hit(["ar", "outstanding", "collect", "receivable", "payment", "due from"])) {
    return {
      topic: "collections",
      answer: `Outstanding AR is ${inr(snap.outstandingAr)} (invoiced ${inr(snap.invoicedTotal)} minus collected ${inr(snap.collectedTotal)}). This month collected ${inr(snap.collectedMtd)}.`,
    };
  }
  if (hit(["invoice", "billed", "sales", "revenue", "mtd"])) {
    return {
      topic: "sales",
      answer: `Invoiced lifetime ${inr(snap.invoicedTotal)}, this month ${inr(snap.invoicedMtd)}. Confirmed open orders: ${snap.openOrders}.`,
    };
  }
  if (hit(["expense", "cost", "spend", "diesel", "vehicle"])) {
    return {
      topic: "expenses",
      answer: `Month-to-date expenses ${inr(snap.expensesMtd)} against collections ${inr(snap.collectedMtd)}. Damaged cost (raw-block rate) ${inr(snap.damagedCost)}.`,
    };
  }
  if (hit(["block", "slab", "stock", "yard", "inventory"])) {
    return {
      topic: "inventory",
      answer: `${snap.blocksOnHand} blocks and ${snap.slabsOnHand} sellable slabs on hand.`,
    };
  }
  if (hit(["cut", "polish", "lpm", "production", "gang", "wip"])) {
    return {
      topic: "production",
      answer: `${snap.openCutting} cutting sessions and ${snap.openPolishing} polishing sessions in progress.`,
    };
  }
  if (hit(["maintain", "machine", "breakdown", "due"])) {
    return {
      topic: "maintenance",
      answer: `${snap.maintenanceDue} maintenance job(s) due within 7 days.`,
    };
  }
  if (hit(["live", "setup", "opening", "status", "book"])) {
    return {
      topic: "status",
      answer: `${snap.factoryName} operating status is ${snap.operatingStatus}. Commercial totals are books-closed only after LIVE.`,
    };
  }
  return { answer: ceoNarrative(snap, exceptions), topic: "brief" };
}
