"use client";

/*
 * The yard, by lot.
 *
 * One line per block — "VG-101 · 90 available" — because that is how the floor
 * talks. There is no per-slab list here on purpose: nobody stencils a number on
 * every piece, and ninety rows would bury the one figure anybody wants.
 */

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { apiFetch, isQueued } from "../../lib/api";
import { formatInr, todayIst } from "../../lib/format";

type Lot = {
  blockId: string;
  blockSerial: string;
  /** "VG01-70" — the block and what is left on it, as the floor says it. */
  label: string;
  variety: string;
  goodSlabCount: number;
  brokenSlabCount: number;
  soldSlabCount: number;
  polishedSlabCount: number;
  unpolishedSlabs: number;
  availableSlabs: number;
  sqftPerSlab: number;
  availableSqft: number;
};

type Machine = { id: string; name: string; machineType: string };

const PROCESSES: Array<{ value: string; label: string }> = [
  { value: "POLISHING", label: "Polishing — makes it sellable" },
  { value: "GRINDING", label: "Grinding" },
  { value: "RESIN", label: "Resin" },
];

type Availability = {
  lots: Lot[];
  totalAvailableSlabs: number;
  totalAvailableSqft: number;
};

type RawBlock = {
  id: string;
  serialNumber: string;
  varietyName: string;
  goodSlabCount?: number;
};

const STAGES: Array<{ value: string; label: string }> = [
  { value: "factory_transport", label: "Moving inside the factory" },
  { value: "loading", label: "Loading for a customer" },
  { value: "yard", label: "Sitting in the yard" },
  { value: "other", label: "Something else" },
];

const num = (value: number) => value.toLocaleString("en-IN");

export default function LotsPage() {
  const [stock, setStock] = useState<Availability | null>(null);
  const [blocks, setBlocks] = useState<RawBlock[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  // Record a cut
  const [cutBlock, setCutBlock] = useState("");
  const [totalCut, setTotalCut] = useState("");
  const [damagedAtSaw, setDamagedAtSaw] = useState("0");
  const [sqftPerSlab, setSqftPerSlab] = useState("");

  // Send a count off a lot through the line
  const [polishBlock, setPolishBlock] = useState("");
  const [polishCount, setPolishCount] = useState("");
  const [polishMachine, setPolishMachine] = useState("");
  const [polishProcess, setPolishProcess] = useState(PROCESSES[0]!.value);
  const [polishFinish, setPolishFinish] = useState("");

  // Write off breakage
  const [offBlock, setOffBlock] = useState("");
  const [offCount, setOffCount] = useState("");
  const [offStage, setOffStage] = useState(STAGES[0]!.value);
  const [offReason, setOffReason] = useState("");
  const [offDate, setOffDate] = useState(todayIst());

  const opIds = useRef<Record<string, string>>({});
  function stableOp(key: string) {
    opIds.current[key] ??= crypto.randomUUID();
    return opIds.current[key];
  }

  const load = useCallback(async () => {
    const [available, rawBlocks, allMachines] = await Promise.all([
      apiFetch<Availability>("/api/v1/lots/available"),
      apiFetch<RawBlock[]>("/api/v1/inventory/raw-blocks"),
      // Not swallowed: a failure here must reach the error banner. Catching it would
      // leave an empty machine list that reads as "none configured" when the real
      // cause is that the call did not work.
      apiFetch<Machine[]>("/api/v1/machines"),
    ]);
    setStock(available);
    setBlocks(rawBlocks);
    setMachines(allMachines.filter((m) => m.machineType === "POLISHING"));
  }, []);

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, [load]);

  async function run(work: () => Promise<void>) {
    setNotice("");
    setError("");
    try {
      await work();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  /** A cut can only be recorded once per block, so offer the uncut ones. */
  const uncut = blocks.filter((b) => !(b.goodSlabCount && b.goodSlabCount > 0));

  async function recordCut(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const result = await apiFetch("/api/v1/lots/cut", {
        method: "POST",
        label: `Cut ${cutBlock}`,
        body: JSON.stringify({
          blockSerial: cutBlock,
          totalSlabsCut: Number(totalCut),
          damagedAtSaw: Number(damagedAtSaw || 0),
          sqftPerSlab: Number(sqftPerSlab),
          clientOpId: stableOp(`cut:${cutBlock}`),
        }),
      });
      delete opIds.current[`cut:${cutBlock}`];
      const good = Number(totalCut) - Number(damagedAtSaw || 0);
      setNotice(
        isQueued(result)
          ? `Cut for ${cutBlock} saved on this device; it will sync.`
          : `${cutBlock}: ${good} good slabs into stock.`,
      );
      setTotalCut("");
      setDamagedAtSaw("0");
      setSqftPerSlab("");
    });
  }

  async function polish(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const result = await apiFetch("/api/v1/lots/polish", {
        method: "POST",
        label: `Polish ${polishBlock} x${polishCount}`,
        body: JSON.stringify({
          blockSerial: polishBlock,
          slabCount: Number(polishCount),
          machineId: polishMachine,
          processType: polishProcess,
          finishType: polishFinish.trim() || undefined,
          clientOpId: stableOp(`polish:${polishBlock}:${polishProcess}:${polishCount}`),
        }),
      });
      opIds.current = {};
      const done = result as { unpolishedSlabs?: number; label?: string };
      setNotice(
        isQueued(result)
          ? "Polishing saved on this device; it will sync."
          : `${polishCount} slab(s) of ${polishBlock} through the line. ` +
            `${done.unpolishedSlabs ?? 0} still unpolished. Lot is now ${done.label ?? ""}.`,
      );
      setPolishCount("");
    });
  }

  async function writeOff(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const result = await apiFetch("/api/v1/lots/write-off", {
        method: "POST",
        label: `Breakage ${offBlock} x${offCount}`,
        body: JSON.stringify({
          blockSerial: offBlock,
          slabCount: Number(offCount),
          stage: offStage,
          reason: offReason,
          occurredOn: offDate,
          clientOpId: stableOp(`off:${offBlock}:${offCount}:${offReason}`),
        }),
      });
      opIds.current = {};
      const saved = result as { slabCount?: number; costAmount?: number; availableSlabs?: number };
      setNotice(
        isQueued(result)
          ? "Breakage saved on this device; it will sync."
          : `${saved.slabCount} slab(s) off ${offBlock} at ${formatInr(saved.costAmount ?? 0)}. ` +
            `${saved.availableSlabs} left.`,
      );
      setOffCount("");
      setOffReason("");
    });
  }

  const lots = stock?.lots ?? [];

  return (
    <AppShell>
      <div className="page">
        <div className="dash-head">
          <h1>Lots</h1>
          <p className="muted">
            Stock counted by block. Available is what was cut, less what broke, less
            what sold.
          </p>
        </div>

        {notice ? <p className="hint">{notice}</p> : null}
        {error ? <p className="error">{error}</p> : null}

        <div className="grid">
          <div className="metric">
            <span>Slabs on hand</span>
            <b>{num(stock?.totalAvailableSlabs ?? 0)}</b>
          </div>
          <div className="metric">
            <span>Sqft on hand</span>
            <b>{num(stock?.totalAvailableSqft ?? 0)}</b>
          </div>
          <div className="metric">
            <span>Lots with stock</span>
            <b>{num(lots.length)}</b>
          </div>
          <div className="metric">
            <span>Still to polish</span>
            <b>{num(lots.reduce((sum, lot) => sum + lot.unpolishedSlabs, 0))}</b>
          </div>
        </div>

        <div className="card wide">
          <h2>On the yard</h2>
          <p>
            <Link href="/lots/sell">Sell from these lots →</Link>
          </p>
          {lots.length === 0 ? (
            <EmptyState>
              Nothing in stock yet. Receive a block, then record its cut below.
            </EmptyState>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Lot</th>
                  <th>Variety</th>
                  <th className="num">Available</th>
                  <th className="num">Sqft</th>
                  <th className="num">Polished</th>
                  <th className="num">Cut</th>
                  <th className="num">Broken</th>
                  <th className="num">Sold</th>
                </tr>
              </thead>
              <tbody>
                {lots.map((lot) => (
                  <tr key={lot.blockId}>
                    <td>
                      <strong>{lot.label}</strong>
                    </td>
                    <td>{lot.variety}</td>
                    <td className="num">
                      <strong>{num(lot.availableSlabs)}</strong>
                    </td>
                    <td className="num">{num(lot.availableSqft)}</td>
                    <td className="num">
                      {num(lot.polishedSlabCount)}
                      {lot.unpolishedSlabs > 0 ? (
                        <span className="muted"> · {num(lot.unpolishedSlabs)} to go</span>
                      ) : null}
                    </td>
                    <td className="num muted">{num(lot.goodSlabCount)}</td>
                    <td className="num muted">{num(lot.brokenSlabCount)}</td>
                    <td className="num muted">{num(lot.soldSlabCount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h2>Record a cut</h2>
          <p className="muted">
            Total slabs off the saw, and how many broke on it. The broken ones never
            reach stock — they are not written off later.
          </p>
          <form onSubmit={recordCut}>
            <label>
              Block
              <select value={cutBlock} onChange={(e) => setCutBlock(e.target.value)}>
                <option value="">Choose a block</option>
                {uncut.map((b) => (
                  <option key={b.id} value={b.serialNumber}>
                    {b.serialNumber} · {b.varietyName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Total slabs cut
              <input
                inputMode="numeric"
                value={totalCut}
                onChange={(e) => setTotalCut(e.target.value)}
                placeholder="96"
              />
            </label>
            <label>
              Broke on the saw
              <input
                inputMode="numeric"
                value={damagedAtSaw}
                onChange={(e) => setDamagedAtSaw(e.target.value)}
              />
            </label>
            <label>
              Sqft per slab
              <input
                inputMode="decimal"
                value={sqftPerSlab}
                onChange={(e) => setSqftPerSlab(e.target.value)}
                placeholder="49.5"
              />
            </label>
            <button type="submit" disabled={!cutBlock || !totalCut || !sqftPerSlab}>
              Record cut
            </button>
          </form>
          {uncut.length === 0 && blocks.length > 0 ? (
            <p className="muted">Every block on record has already been cut.</p>
          ) : null}
        </div>

        <div className="card">
          <h2>Through the line</h2>
          <p className="muted">
            Pick the lot and how many slabs went through. Polishing is what makes a
            slab sellable; grinding and resin are stages on the way, so they are
            recorded but do not count as finished.
          </p>
          <form onSubmit={polish}>
            <label>
              Lot
              <select value={polishBlock} onChange={(e) => setPolishBlock(e.target.value)}>
                <option value="">Choose a lot</option>
                {lots.map((lot) => (
                  <option key={lot.blockId} value={lot.blockSerial}>
                    {lot.label} · {lot.unpolishedSlabs} unpolished
                  </option>
                ))}
              </select>
            </label>
            <label>
              How many slabs
              <input
                inputMode="numeric"
                value={polishCount}
                onChange={(e) => setPolishCount(e.target.value)}
                placeholder={String(
                  lots.find((l) => l.blockSerial === polishBlock)?.unpolishedSlabs ?? "",
                )}
              />
            </label>
            <label>
              Machine
              <select
                value={polishMachine}
                onChange={(e) => setPolishMachine(e.target.value)}
              >
                <option value="">Choose a machine</option>
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Stage
              <select
                value={polishProcess}
                onChange={(e) => setPolishProcess(e.target.value)}
              >
                {PROCESSES.map((pr) => (
                  <option key={pr.value} value={pr.value}>
                    {pr.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Finish
              <input
                value={polishFinish}
                onChange={(e) => setPolishFinish(e.target.value)}
                placeholder="mirror, honed, leather"
              />
            </label>
            <button
              type="submit"
              disabled={!polishBlock || !polishCount || !polishMachine}
            >
              Record it
            </button>
          </form>
          {machines.length === 0 ? (
            <p className="muted">
              No polishing machine on record yet. Add one before recording a run.
            </p>
          ) : null}
          {polishBlock && polishCount ? (
            <p className="hint">
              {polishCount} of{" "}
              {lots.find((l) => l.blockSerial === polishBlock)?.unpolishedSlabs} unpolished
              on {polishBlock}. Polishing does not change how many slabs the yard has —
              only how many of them are finished.
            </p>
          ) : null}
        </div>

        <div className="card">
          <h2>Broken slabs</h2>
          <p className="muted">
            Takes them off the yard and off the books, at what they cost. Recorded
            against your name — so say what happened.
          </p>
          <form onSubmit={writeOff}>
            <label>
              Block
              <select value={offBlock} onChange={(e) => setOffBlock(e.target.value)}>
                <option value="">Choose a lot</option>
                {lots.map((lot) => (
                  <option key={lot.blockId} value={lot.blockSerial}>
                    {lot.label} · {lot.availableSlabs} available
                  </option>
                ))}
              </select>
            </label>
            <label>
              How many broke
              <input
                inputMode="numeric"
                value={offCount}
                onChange={(e) => setOffCount(e.target.value)}
                placeholder="3"
              />
            </label>
            <label>
              Where
              <select value={offStage} onChange={(e) => setOffStage(e.target.value)}>
                {STAGES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              What happened
              <input
                value={offReason}
                onChange={(e) => setOffReason(e.target.value)}
                placeholder="forklift tilted the A-frame"
              />
            </label>
            <label>
              Date
              <input
                type="date"
                max={todayIst()}
                value={offDate}
                onChange={(e) => setOffDate(e.target.value)}
              />
            </label>
            <button
              type="submit"
              disabled={!offBlock || !offCount || !offReason.trim()}
            >
              Remove from stock
            </button>
          </form>
          {offBlock && offCount ? (
            <p className="hint">
              {offCount} of {lots.find((l) => l.blockSerial === offBlock)?.availableSlabs}{" "}
              available on {offBlock}. The value is worked out from what that block cost
              and shown once it is saved.
            </p>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
