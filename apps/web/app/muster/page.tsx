"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { canAccess, MUSTER_PAY_ROLES, type PublicUser } from "@stoneos/contracts";
import { apiFetch, isQueued } from "../../lib/api";
import { todayIst } from "../../lib/format";
import { bodyOf, queuedAt, useOutbox } from "../../lib/useOutbox";

type Worker = { id: string; name: string; kind: string; dailyWageMinor?: number | null };
type Row = { id: string; status: string; worker: Worker };

export default function MusterPage() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [name, setName] = useState("");
  const [wage, setWage] = useState("800");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [canHire, setCanHire] = useState(false);
  const { items, refresh: refreshQueue } = useOutbox();
  // Marks made offline for the date on screen, newest per worker.
  const queuedMarks = new Map(
    queuedAt(items, "/api/v1/muster/attendance")
      .map((q) => bodyOf<{ workerId: string; date: string; status: string }>(q))
      .filter((b) => b.date === date)
      .map((b) => [b.workerId, b.status]),
  );

  useEffect(() => {
    apiFetch<PublicUser>("/api/v1/auth/me")
      .then((me) => setCanHire(canAccess(me.role, MUSTER_PAY_ROLES)))
      .catch(() => undefined);
  }, []);

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
      {error ? <p className="error" role="alert">{error}</p> : null}
      {notice ? <p className="muted" role="status">{notice}</p> : null}
      <div className="card">
        {canHire ? (
        <form onSubmit={addWorker}>
          <label>Worker<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
          <label>Daily wage<input value={wage} onChange={(e) => setWage(e.target.value)} /></label>
          <button type="submit">Add worker</button>
        </form>
        ) : (
          <p className="muted">Workers are added by the owner, a manager or the accountant, because they set the daily wage. You can mark attendance below.</p>
        )}
      </div>
      <div className="card">
        <label>Date<input type="date" value={date} max={todayIst()} onChange={(e) => { setDate(e.target.value); refresh(e.target.value).catch(() => undefined); }} /></label>
        {workers.length === 0 ? <EmptyState>No workers yet.</EmptyState> : workers.map((w) => (
          <p key={w.id}>
            {w.name}
            {queuedMarks.has(w.id) ? <span className="pending-tag">{queuedMarks.get(w.id)} · not synced</span> : null}
            {["present", "absent", "half", "ot"].map((status) => (
              <button
                key={status}
                type="button"
                className="secondary"
                onClick={async () => {
                  setError("");
                  try {
                    const result = await apiFetch("/api/v1/muster/attendance", {
                      method: "POST",
                      label: `Attendance ${w.name} ${date}: ${status}`,
                      body: JSON.stringify({ workerId: w.id, date, status }),
                    });
                    setNotice(isQueued(result) ? `${w.name} marked ${status} — saved on this phone, syncs when online.` : `${w.name} marked ${status}.`);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Could not mark attendance");
                  }
                  await Promise.all([refresh().catch(() => undefined), refreshQueue()]);
                }}
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
