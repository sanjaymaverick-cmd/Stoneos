"use client";

import { useEffect, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { apiFetch } from "../../lib/api";

export default function DashboardPage() {
  const [data, setData] = useState<{
    blocksOnHand: number;
    slabsOnHand: number;
    openCutting: number;
    openOrders: number;
    maintenanceDue: number;
  } | null>(null);
  const [factory, setFactory] = useState<{ name: string; operatingStatus: string } | null>(null);
  useEffect(() => {
    apiFetch("/api/v1/reports/dashboard").then(setData).catch(() => undefined);
    apiFetch("/api/v1/factory/me").then(setFactory).catch(() => undefined);
  }, []);
  return (
    <AppShell>
      <h1>{factory?.name ?? "Dashboard"}</h1>
      <p>Status: {factory?.operatingStatus ?? "—"}</p>
      <div className="grid">
        <div className="metric"><span>Blocks on hand</span><b>{data?.blocksOnHand ?? "—"}</b></div>
        <div className="metric"><span>Slabs on hand</span><b>{data?.slabsOnHand ?? "—"}</b></div>
        <div className="metric"><span>Open cutting</span><b>{data?.openCutting ?? "—"}</b></div>
        <div className="metric"><span>Open orders</span><b>{data?.openOrders ?? "—"}</b></div>
        <div className="metric"><span>Maintenance due</span><b>{data?.maintenanceDue ?? "—"}</b></div>
      </div>
    </AppShell>
  );
}
