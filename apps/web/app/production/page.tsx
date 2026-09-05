"use client";

import { FormEvent, useEffect, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { apiFetch } from "../../lib/api";

export default function ProductionPage() {
  const [machines, setMachines] = useState<Array<{ id: string; name: string }>>([]);
  const [blocks, setBlocks] = useState<Array<{ id: string; serialNumber: string }>>([]);
  const [sessions, setSessions] = useState<Array<{ id: string; status: string; rawBlock: { serialNumber: string } }>>([]);
  const [rawBlockId, setBlock] = useState("");
  const [machineId, setMachine] = useState("");
  const [total, setTotal] = useState(10);
  const [good, setGood] = useState(9);
  const [slabs, setSlabs] = useState<Array<{ id: string; slabSerial: string }>>([]);
  const [polishMachine, setPolishMachine] = useState("");
  const [selectedSlabs, setSelectedSlabs] = useState<string[]>([]);

  async function refresh() {
    const [m, b, s, sl] = await Promise.all([
      apiFetch<Array<{ id: string; name: string }>>("/api/v1/machines"),
      apiFetch<Array<{ id: string; serialNumber: string }>>("/api/v1/inventory/raw-blocks"),
      apiFetch<Array<{ id: string; status: string; rawBlock: { serialNumber: string } }>>("/api/v1/cutting-sessions"),
      apiFetch<Array<{ id: string; slabSerial: string }>>("/api/v1/inventory/slabs"),
    ]);
    setMachines(m);
    setBlocks(b);
    setSessions(s);
    setSlabs(sl);
    setMachine(m[0]?.id ?? "");
    setBlock(b[0]?.id ?? "");
    const lpm = m.find((row) => row.name === "LPM");
    setPolishMachine(lpm?.id ?? m[0]?.id ?? "");
  }
  useEffect(() => { refresh().catch(() => undefined); }, []);

  async function start(event: FormEvent) {
    event.preventDefault();
    await apiFetch("/api/v1/cutting-sessions", { method: "POST", body: JSON.stringify({ rawBlockId, machineId }) });
    await refresh();
  }

  async function complete(id: string) {
    await apiFetch(`/api/v1/cutting-sessions/${id}/complete`, {
      method: "POST",
      body: JSON.stringify({ totalSlabsCut: total, finalGoodSlabCount: good }),
    });
    await refresh();
  }

  return (
    <AppShell>
      <h1>Production</h1>
      <div className="card">
        <h2>Start cutting session</h2>
        <form onSubmit={start}>
          <label>Block
            <select value={rawBlockId} onChange={(e) => setBlock(e.target.value)}>
              {blocks.map((b) => <option key={b.id} value={b.id}>{b.serialNumber}</option>)}
            </select>
          </label>
          <label>Machine
            <select value={machineId} onChange={(e) => setMachine(e.target.value)}>
              {machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <button type="submit">Allocate to saw</button>
        </form>
      </div>
      <div className="card">
        <h2>Complete session</h2>
        <label>Total cut<input type="number" value={total} onChange={(e) => setTotal(Number(e.target.value))} /></label>
        <label>Good slabs<input type="number" value={good} onChange={(e) => setGood(Number(e.target.value))} /></label>
        {sessions.filter((s) => s.status === "IN_PROGRESS").length === 0 ? (
          <EmptyState>No cutting session in progress. Allocate a block to the saw first.</EmptyState>
        ) : null}
        {sessions.filter((s) => s.status === "IN_PROGRESS").map((s) => (
          <p key={s.id}>
            {s.rawBlock.serialNumber}
            <button onClick={() => complete(s.id)}>Complete</button>
          </p>
        ))}
      </div>
      <div className="card">
        <h2>Polishing / grinding / resin</h2>
        <label>LPM
          <select value={polishMachine} onChange={(e) => setPolishMachine(e.target.value)}>
            {machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <label>Slabs
          <select multiple value={selectedSlabs} onChange={(e) => setSelectedSlabs([...e.target.selectedOptions].map((o) => o.value))}>
            {slabs.map((s) => <option key={s.id} value={s.id}>{s.slabSerial}</option>)}
          </select>
        </label>
        <button type="button" onClick={async () => {
          const session = await apiFetch<{ id: string }>("/api/v1/polishing-sessions", {
            method: "POST",
            body: JSON.stringify({ machineId: polishMachine, processType: "POLISHING", slabIds: selectedSlabs, finishType: "glossy" }),
          });
          await apiFetch(`/api/v1/polishing-sessions/${session.id}/complete`, { method: "POST" });
          await refresh();
        }}>Polish selected</button>
        <button type="button" className="secondary" onClick={() => apiFetch("/api/v1/machine-logs", {
          method: "POST",
          body: JSON.stringify({ machineId: polishMachine || machineId, runtimeHours: 20, downtimeMinutes: 30 }),
        })}>Log 20h runtime</button>
      </div>
    </AppShell>
  );
}
