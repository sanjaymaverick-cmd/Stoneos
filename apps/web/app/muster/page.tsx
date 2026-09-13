"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { apiFetch } from "../../lib/api";

type Worker = { id: string; name: string; kind: string; dailyWageMinor?: number | null };
type Row = { id: string; status: string; worker: Worker };

export default function MusterPage() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [name, setName] = useState("");
  const [wage, setWage] = useState("800");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState("");

  async function refresh(d = date) {
    setWorkers(await apiFetch("/api/v1/muster/workers"));
    setRows(await apiFetch(`/api/v1/muster/attendance?date=${d}`));
  }
  useEffect(() => { refresh().catch(() => undefined); }, []);

  async function addWorker(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await apiFetch("/api/v1/muster/workers", {
        method: "POST",
        body: JSON.stringify({ name, kind: "helper", dailyWage: Number(wage) }),
      });
      setName("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add worker");
    }
  }

  return (
    <AppShell>
      <h1>Muster</h1>
      <p>Mark attendance for the operational day. Payroll sheets are on <Link href="/muster/payroll">wage sheet</Link>.</p>
      {error ? <p className="error">{error}</p> : null}
      <div className="card">
        <form onSubmit={addWorker}>
          <label>Worker<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
          <label>Daily wage<input value={wage} onChange={(e) => setWage(e.target.value)} /></label>
          <button type="submit">Add worker</button>
        </form>
      </div>
      <div className="card">
        <label>Date<input type="date" value={date} onChange={(e) => { setDate(e.target.value); refresh(e.target.value).catch(() => undefined); }} /></label>
        {workers.length === 0 ? <EmptyState>No workers yet.</EmptyState> : workers.map((w) => (
          <p key={w.id}>
            {w.name}
            {["present", "absent", "half", "ot"].map((status) => (
              <button
                key={status}
                type="button"
                className="secondary"
                onClick={() => apiFetch("/api/v1/muster/attendance", { method: "POST", body: JSON.stringify({ workerId: w.id, date, status }) }).then(() => refresh())}
              >
                {status}
              </button>
            ))}
          </p>
        ))}
      </div>
      {rows.length === 0 ? null : (
        <ul>{rows.map((r) => <li key={r.id}>{r.worker.name} — {r.status}</li>)}</ul>
      )}
    </AppShell>
  );
}
