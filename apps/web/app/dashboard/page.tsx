"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { apiFetch } from "../../lib/api";
import { formatInr } from "../../lib/format";
type Today = {
  collectedMtd: number;
  outstandingAr: number;
  blocksOnHand: number;
  slabsOnHand: number;
  maintenanceDue: number;
  expensesMtd: number;
  recoveryRatio: number | null;
  recoveryBenchmark: number;
};
export default function DashboardPage() {
  const [d, setD] = useState<Today | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    apiFetch<Today>("/api/v1/reports/today")
      .then(setD)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <AppShell>
      <h1>Today</h1>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="grid today-tiles">
        <div className="metric ok">
          <span>Collected month</span>
          <b>{d ? formatInr(d.collectedMtd) : "…"}</b>
        </div>
        <div className={`metric ${d && d.outstandingAr > 0 ? "bad" : ""}`}>
          <span>Outstanding AR</span>
          <b>{d ? formatInr(d.outstandingAr) : "…"}</b>
        </div>
        <div className="metric">
          <span>Blocks on hand</span>
          <b>{d?.blocksOnHand ?? "…"}</b>
        </div>
        <div className="metric">
          <span>Slabs on hand</span>
          <b>{d?.slabsOnHand ?? "…"}</b>
        </div>
      </div>
      {d && (
        <>
          <aside className="alert-strip">
            {d.outstandingAr > 0 && (
              <p>
                <Link href="/sales">Unpaid invoices need collection.</Link>
              </p>
            )}
            {d.maintenanceDue > 0 && (
              <p>
                <Link href="/maintenance">
                  Maintenance due within seven days.
                </Link>
              </p>
            )}
            {d.expensesMtd > d.collectedMtd && (
              <p>Expenses exceed collections this month.</p>
            )}
          </aside>
          <p className="muted">
            {d.recoveryRatio === null
              ? "Recovery: waiting until a block is sold out."
              : `Recovery ${d.recoveryRatio.toFixed(1)} sqft/ton · benchmark ${d.recoveryBenchmark}`}
          </p>
        </>
      )}
    </AppShell>
  );
}
