"use client";

import { FormEvent, useEffect, useState } from "react";
import { AppShell } from "../../../components/AppShell";
import { apiFetch } from "../../../lib/api";

type Snapshot = { id: string; status: string; lines: unknown[] };

export default function OpeningInventoryPage() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [currentId, setCurrentId] = useState("");
  const [kind, setKind] = useState<"RAW_BLOCK" | "UNPOLISHED_SLAB" | "POLISHED_SLAB">("RAW_BLOCK");
  const [serial, setSerial] = useState("");
  const [variety, setVariety] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    const rows = await apiFetch<Snapshot[]>("/api/v1/inventory/opening");
    setSnapshots(rows);
    if (!currentId && rows[0]) setCurrentId(rows[0].id);
  }
  useEffect(() => { refresh().catch(() => undefined); }, []);

  async function start() {
    const created = await apiFetch<Snapshot>("/api/v1/inventory/opening", { method: "POST" });
    setCurrentId(created.id);
    await refresh();
  }

  async function addLine(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const payload =
        kind === "RAW_BLOCK"
          ? { serialNumber: serial, varietyName: variety }
          : { slabSerial: serial, varietyName: variety };
      await apiFetch(`/api/v1/inventory/opening/${currentId}/lines`, {
        method: "POST",
        body: JSON.stringify({ kind, payload }),
      });
      setSerial("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add line");
    }
  }

  return (
    <AppShell>
      <h1>Opening inventory</h1>
      <p>Draft counts do not move stock. Approval by a different owner/manager posts receipts and sets the factory live.</p>
      <div className="card">
        <button type="button" onClick={start}>Start count</button>
        <label>Active snapshot
          <select value={currentId} onChange={(e) => setCurrentId(e.target.value)}>
            {snapshots.map((s) => (
              <option key={s.id} value={s.id}>{s.status} — {s.id.slice(0, 8)} ({s.lines.length} lines)</option>
            ))}
          </select>
        </label>
        <form onSubmit={addLine}>
          <label>Kind
            <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="RAW_BLOCK">Raw block</option>
              <option value="UNPOLISHED_SLAB">Unpolished slab</option>
              <option value="POLISHED_SLAB">Polished slab</option>
            </select>
          </label>
          <label>Serial<input value={serial} onChange={(e) => setSerial(e.target.value)} required /></label>
          <label>Variety<input value={variety} onChange={(e) => setVariety(e.target.value)} required /></label>
          {error ? <p className="error">{error}</p> : null}
          <button type="submit">Add line</button>
        </form>
        <p>
          <button type="button" className="secondary" onClick={() => apiFetch(`/api/v1/inventory/opening/${currentId}/submit`, { method: "POST" }).then(refresh)}>Submit</button>
          {" "}
          <button type="button" onClick={() => apiFetch(`/api/v1/inventory/opening/${currentId}/approve`, { method: "POST" }).then(refresh).catch((err) => setError(err.message))}>Approve (different user)</button>
        </p>
      </div>
    </AppShell>
  );
}
