"use client";

import { useEffect, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { apiFetch } from "../../lib/api";

type ShopMetrics = {
  blocksOnHand: number;
  slabsOnHand: number;
  openCutting: number;
  openOrders: number;
  maintenanceDue: number;
};

type CeoBrief = ShopMetrics & {
  factoryName: string;
  operatingStatus: string;
  generatedAt: string;
  briefKind: string;
  openPolishing: number;
  invoicedTotal: number;
  collectedTotal: number;
  outstandingAr: number;
  invoicedMtd: number;
  collectedMtd: number;
  expensesMtd: number;
  damagedCost: number;
  recoveryRatio: number | null;
  recoveryBenchmark: number;
  exceptions: Array<{ code: string; severity: string; message: string }>;
};

function inr(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export default function DashboardPage() {
  const [shop, setShop] = useState<ShopMetrics | null>(null);
  const [ceo, setCeo] = useState<CeoBrief | null>(null);
  const [factory, setFactory] = useState<{ name: string; operatingStatus: string } | null>(null);

  useEffect(() => {
    apiFetch<ShopMetrics>("/api/v1/reports/dashboard").then(setShop).catch(() => undefined);
    apiFetch<{ name: string; operatingStatus: string }>("/api/v1/factory/me")
      .then(setFactory)
      .catch(() => undefined);
    apiFetch<CeoBrief>("/api/v1/reports/ceo")
      .then(setCeo)
      .catch(() => undefined);
  }, []);

  const name = ceo?.factoryName ?? factory?.name ?? "Factory";
  const status = ceo?.operatingStatus ?? factory?.operatingStatus ?? "loading…";

  return (
    <AppShell>
      <h1>{name}</h1>
      <p>
        Status: {status}
        {ceo ? " · CEO brief (ledger rules, no model)" : ""}
      </p>
      <div className="grid">
        <div className="metric">
          <span>Blocks on hand</span>
          <b>{(ceo ?? shop)?.blocksOnHand ?? "—"}</b>
        </div>
        <div className="metric">
          <span>Slabs on hand</span>
          <b>{(ceo ?? shop)?.slabsOnHand ?? "—"}</b>
        </div>
        <div className="metric">
          <span>Open cutting</span>
          <b>{(ceo ?? shop)?.openCutting ?? "—"}</b>
        </div>
        <div className="metric">
          <span>Open orders</span>
          <b>{(ceo ?? shop)?.openOrders ?? "—"}</b>
        </div>
        <div className="metric">
          <span>Maintenance due</span>
          <b>{(ceo ?? shop)?.maintenanceDue ?? "—"}</b>
        </div>
        {ceo ? (
          <>
            <div className="metric">
              <span>Recovery vs 105</span>
              <b>{ceo.recoveryRatio === null ? "—" : ceo.recoveryRatio.toFixed(1)}</b>
            </div>
            <div className="metric">
              <span>Invoiced MTD</span>
              <b>{inr(ceo.invoicedMtd)}</b>
            </div>
            <div className="metric">
              <span>Collected MTD</span>
              <b>{inr(ceo.collectedMtd)}</b>
            </div>
            <div className="metric">
              <span>Outstanding AR</span>
              <b>{inr(ceo.outstandingAr)}</b>
            </div>
            <div className="metric">
              <span>Expenses MTD</span>
              <b>{inr(ceo.expensesMtd)}</b>
            </div>
            <div className="metric">
              <span>Damaged cost</span>
              <b>{inr(ceo.damagedCost)}</b>
            </div>
            <div className="metric">
              <span>Open polish</span>
              <b>{ceo.openPolishing}</b>
            </div>
          </>
        ) : null}
      </div>
      {ceo && ceo.exceptions.length > 0 ? (
        <section className="card" style={{ marginTop: 16 }}>
          <h2>Exceptions</h2>
          <ul>
            {ceo.exceptions.map((ex) => (
              <li key={ex.code}>
                <strong>{ex.severity}</strong> — {ex.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </AppShell>
  );
}
