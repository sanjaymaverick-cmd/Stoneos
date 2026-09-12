"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { AppShell } from "../../../components/AppShell";
import { EmptyState } from "../../../components/EmptyState";
import { apiFetch } from "../../../lib/api";

type Sheet = {
  id: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  lines: Array<{ worker: { name: string }; days: string; amountMinor: number }>;
};

export default function PayrollPage() {
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [start, setStart] = useState("2026-09-01");
  const [end, setEnd] = useState("2026-09-12");
  const [error, setError] = useState("");
  const op = useRef(crypto.randomUUID());

  async function refresh() {
    setSheets(await apiFetch("/api/v1/muster/sheets"));
  }
  useEffect(() => { refresh().catch(() => undefined); }, []);

  async function draft(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await apiFetch("/api/v1/muster/sheets", {
        method: "POST",
        body: JSON.stringify({ periodStart: start, periodEnd: end, clientOpId: op.current }),
      });
      op.current = crypto.randomUUID();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Draft failed");
    }
  }

  return (
    <AppShell>
      <p><Link href="/muster">← Muster</Link></p>
      <h1>Wage sheet</h1>
      <p>A different person confirms the draft. Pay posts EXP_LABOUR / cash. Supervisor cannot pay.</p>
      {error ? <p className="error">{error}</p> : null}
      <div className="card">
        <form onSubmit={draft}>
          <label>From<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label>To<input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
          <button type="submit">Draft sheet</button>
        </form>
      </div>
      {sheets.length === 0 ? <EmptyState>No wage sheets yet.</EmptyState> : sheets.map((s) => (
        <div className="card" key={s.id}>
          <h2>{String(s.periodStart).slice(0, 10)} – {String(s.periodEnd).slice(0, 10)} · {s.status}</h2>
          <ul>{s.lines.map((l, i) => <li key={i}>{l.worker.name} · {l.days} days · ₹{(l.amountMinor / 100).toLocaleString("en-IN")}</li>)}</ul>
          {s.status === "draft" ? <button type="button" onClick={() => apiFetch(`/api/v1/muster/sheets/${s.id}/confirm`, { method: "POST" }).then(refresh).catch((e) => setError(e instanceof Error ? e.message : "Confirm failed"))}>Confirm</button> : null}
          {s.status === "confirmed" ? <button type="button" onClick={() => apiFetch(`/api/v1/muster/sheets/${s.id}/pay`, { method: "POST", body: JSON.stringify({ method: "cash" }) }).then(refresh).catch((e) => setError(e instanceof Error ? e.message : "Pay failed"))}>Pay</button> : null}
        </div>
      ))}
    </AppShell>
  );
}
