"use client";

import { FormEvent, useEffect, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { apiFetch, isQueued, newOpId, ref } from "../../lib/api";
import { bodyOf, queuedAt, useOutbox } from "../../lib/useOutbox";

type Machine = { id: string; name: string; machineType?: string };
type Block = { id: string; serialNumber: string; currentStatus?: string };
type Session = { id: string; status: string; rawBlock: { serialNumber: string } };
type Slab = { id: string; slabSerial: string };

/** A choice that is either a server id or a reference to a write still on this phone. */
type Choice = { value: string; label: string; pending?: boolean };

export default function ProductionPage() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [rawBlockId, setBlock] = useState("");
  const [machineId, setMachine] = useState("");
  const [total, setTotal] = useState(10);
  const [good, setGood] = useState(9);
  const [slabs, setSlabs] = useState<Slab[]>([]);
  const [polishMachine, setPolishMachine] = useState("");
  const [selectedSlabs, setSelectedSlabs] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const { items, refresh: refreshQueue } = useOutbox();

  async function refresh() {
    const [m, b, s, sl] = await Promise.all([
      apiFetch<Machine[]>("/api/v1/machines"),
      apiFetch<Block[]>("/api/v1/inventory/raw-blocks"),
      apiFetch<Session[]>("/api/v1/cutting-sessions"),
      apiFetch<Slab[]>("/api/v1/inventory/slabs"),
    ]);
    setMachines(m);
    setBlocks(b);
    setSessions(s);
    setSlabs(sl);
    setMachine((current) => current || (m.find((row) => row.machineType === "CUTTING") ?? m[0])?.id || "");
    const lpm = m.find((row) => row.machineType === "POLISHING") ?? m.find((row) => row.name === "LPM");
    setPolishMachine((current) => current || lpm?.id || m[0]?.id || "");
  }
  useEffect(() => { refresh().catch(() => undefined); }, []);

  // Work done on this phone that the server has not seen yet.
  const queuedBlocks = queuedAt(items, "/api/v1/inventory/raw-blocks");
  const queuedStarts = queuedAt(items, "/api/v1/cutting-sessions");
  const queuedCompletes = queuedAt(items, /^\/api\/v1\/cutting-sessions\/[^/]+\/complete$/);
  const completedRefs = new Set(queuedCompletes.map((c) => c.path.split("/")[4]));
  const serialFor = (blockId: string) => {
    const known = blocks.find((b) => b.id === blockId);
    if (known) return known.serialNumber;
    const queued = queuedBlocks.find((q) => ref(q.clientOpId, "block.id") === blockId);
    return queued ? bodyOf<{ serialNumber: string }>(queued).serialNumber : "block";
  };

  const blockChoices: Choice[] = [
    ...blocks.filter((b) => !b.currentStatus || b.currentStatus === "in_stock").map((b) => ({ value: b.id, label: b.serialNumber })),
    ...queuedBlocks.map((q) => ({ value: ref(q.clientOpId, "block.id"), label: bodyOf<{ serialNumber: string }>(q).serialNumber, pending: true })),
  ];
  const openSessions: Choice[] = [
    ...sessions.filter((s) => s.status === "IN_PROGRESS").map((s) => ({ value: s.id, label: s.rawBlock.serialNumber })),
    ...queuedStarts
      .filter((q) => !completedRefs.has(ref(q.clientOpId)))
      .map((q) => ({ value: ref(q.clientOpId), label: serialFor(bodyOf<{ rawBlockId: string }>(q).rawBlockId), pending: true })),
  ];
  const slabChoices: Choice[] = [
    ...slabs.map((s) => ({ value: s.id, label: s.slabSerial })),
    ...queuedCompletes.map((q) => ({
      value: ref(q.clientOpId, "slabs[*].id"),
      label: `All ${bodyOf<{ finalGoodSlabCount: number }>(q).finalGoodSlabCount} slabs from a cut not synced yet`,
      pending: true,
    })),
  ];
  const effectiveBlock = rawBlockId || blockChoices[0]?.value || "";

  function report(result: unknown, done: string) {
    setError("");
    setNotice(isQueued(result) ? `${done} — saved on this phone, will sync when online (${result.pendingRef}).` : `${done}.`);
  }

  async function run(action: () => Promise<void>) {
    try {
      await action();
    } catch (err) {
      setNotice("");
      setError(err instanceof Error ? err.message : "Could not save");
    }
    await Promise.all([refresh().catch(() => undefined), refreshQueue()]);
  }

  async function start(event: FormEvent) {
    event.preventDefault();
    const serial = blockChoices.find((b) => b.value === effectiveBlock)?.label ?? "block";
    await run(async () => {
      const result = await apiFetch("/api/v1/cutting-sessions", {
        method: "POST",
        label: `Start cutting ${serial}`,
        body: JSON.stringify({ rawBlockId: effectiveBlock, machineId }),
      });
      setBlock("");
      report(result, `Cutting started on ${serial}`);
    });
  }

  async function complete(session: Choice) {
    await run(async () => {
      const result = await apiFetch(`/api/v1/cutting-sessions/${session.value}/complete`, {
        method: "POST",
        label: `Complete cutting ${session.label} (${good} good of ${total})`,
        body: JSON.stringify({ totalSlabsCut: total, finalGoodSlabCount: good }),
      });
      report(result, `Cutting completed for ${session.label}`);
    });
  }

  async function polish() {
    if (selectedSlabs.length === 0) return;
    await run(async () => {
      // Name the polishing run up front so its completion can follow it offline.
      const startOp = newOpId();
      const started = await apiFetch<{ id: string }>("/api/v1/polishing-sessions", {
        method: "POST",
        label: "Start polishing",
        body: JSON.stringify({
          clientOpId: startOp,
          machineId: polishMachine,
          processType: "POLISHING",
          slabIds: selectedSlabs,
          finishType: "glossy",
        }),
      });
      const sessionId = isQueued(started) ? ref(startOp) : started.id;
      const finished = await apiFetch(`/api/v1/polishing-sessions/${sessionId}/complete`, {
        method: "POST",
        label: "Finish polishing",
        body: JSON.stringify({}),
      });
      setSelectedSlabs([]);
      report(finished, "Polishing recorded");
    });
  }

  const pendingTag = (c: Choice) => (c.pending ? " · not synced" : "");

  return (
    <AppShell>
      <h1>Production</h1>
      {notice ? <p className="muted" role="status">{notice}</p> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      <div className="card">
        <h2>Start cutting session</h2>
        <form onSubmit={start}>
          <label>Block
            <select value={effectiveBlock} onChange={(e) => setBlock(e.target.value)}>
              {blockChoices.length === 0 ? <option value="">No block in the yard</option> : null}
              {blockChoices.map((b) => <option key={b.value} value={b.value}>{b.label}{pendingTag(b)}</option>)}
            </select>
          </label>
          <label>Machine
            <select value={machineId} onChange={(e) => setMachine(e.target.value)}>
              {machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <button type="submit" disabled={!effectiveBlock || !machineId}>Allocate to saw</button>
        </form>
      </div>
      <div className="card">
        <h2>Complete session</h2>
        <label>Total cut<input type="number" inputMode="numeric" value={total} onChange={(e) => setTotal(Number(e.target.value))} /></label>
        <label>Good slabs<input type="number" inputMode="numeric" value={good} onChange={(e) => setGood(Number(e.target.value))} /></label>
        {openSessions.length === 0 ? (
          <EmptyState>No cutting session in progress. Allocate a block to the saw first.</EmptyState>
        ) : null}
        {openSessions.map((s) => (
          <p key={s.value}>
            {s.label}
            {s.pending ? <span className="pending-tag">not synced</span> : null}{" "}
            <button type="button" onClick={() => complete(s)}>Complete</button>
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
            {slabChoices.map((s) => <option key={s.value} value={s.value}>{s.label}{pendingTag(s)}</option>)}
          </select>
        </label>
        <button type="button" disabled={selectedSlabs.length === 0} onClick={polish}>Polish selected</button>{" "}
        <button type="button" className="secondary" onClick={() => run(async () => {
          const result = await apiFetch("/api/v1/machine-logs", {
            method: "POST",
            label: "Machine runtime 20h",
            body: JSON.stringify({ machineId: polishMachine || machineId, runtimeHours: 20, downtimeMinutes: 30 }),
          });
          report(result, "Runtime logged");
        })}>Log 20h runtime</button>
      </div>
    </AppShell>
  );
}
