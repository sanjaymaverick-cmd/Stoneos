"use client";

import { useEffect, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { apiFetch } from "../../lib/api";

export default function RecoveryPage() {
  const [rows, setRows] = useState<Array<{ serialNumber: string; soldSqft: number; weightTons: number; ratio: number | null }>>([]);
  useEffect(() => {
    apiFetch("/api/v1/recovery-ratio").then(setRows).catch(() => undefined);
  }, []);
  return (
    <AppShell>
      <h1>Recovery ratio</h1>
      <p>Sale-time sqft per ton of parent block. Benchmark is 105 sqft/ton. Production dimensions are not used.</p>
      {rows.length === 0 ? (
        <EmptyState>No sold blocks yet. Recovery appears after an invoice is issued against a parent block.</EmptyState>
      ) : (
      <table>
        <thead><tr><th>Block</th><th>Sold sqft</th><th>Tons</th><th>Ratio</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.serialNumber}>
              <td>{r.serialNumber}</td>
              <td>{r.soldSqft}</td>
              <td>{r.weightTons}</td>
              <td>{r.ratio === null ? "—" : r.ratio.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      )}
    </AppShell>
  );
}
