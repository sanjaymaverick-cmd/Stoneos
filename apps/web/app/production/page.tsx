"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { slabLabel, slabSqft, todayIst } from "../../lib/format";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { apiFetch, isQueued, newOpId, ref } from "../../lib/api";
import { bodyOf, queuedAt, useOutbox } from "../../lib/useOutbox";

type Machine = { id: string; name: string; machineType?: string };
type Block = {
  id: string;
  serialNumber: string;
  currentStatus?: string;
  weightTons?: string | number;
};
type Session = {
  id: string;
  status: string;
  rawBlock: { serialNumber: string };
};
type Slab = {
  id: string;
  slabSerial: string;
  parentBlockId?: string;
  parentBlock?: { serialNumber: string };
  salesStatus?: string;
  lengthFt?: string | number;
  widthFt?: string | number;
};

/** A choice that is either a server id or a reference to a write still on this phone. */
type Choice = {
  value: string;
  label: string;
  pending?: boolean;
  count?: number;
  area?: number | null;
};

function productionTimestamp(day: string) {
  return day === todayIst()
    ? new Date().toISOString()
    : `${day}T12:00:00+05:30`;
}
const earliestProductionDate = () =>
  todayIst(new Date(Date.now() - 13 * 86400000));

export default function ProductionPage() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [rawBlockId, setBlock] = useState("");
  const [machineId, setMachine] = useState("");
  const [completionSession, setCompletionSession] = useState("");
  const [total, setTotal] = useState("");
  const [good, setGood] = useState("");
  const [lengthFt, setLengthFt] = useState("");
  const [widthFt, setWidthFt] = useState("");
  const [thicknessMm, setThicknessMm] = useState("18");
  const [cutDate, setCutDate] = useState(todayIst());
  const [reviewCut, setReviewCut] = useState(false);
  const [processType, setProcessType] = useState("GRINDING");
  const [finishType, setFinishType] = useState("glossy");
  const [slabSearch, setSlabSearch] = useState("");
  const [slabPage, setSlabPage] = useState(1);
  const [slabTotal, setSlabTotal] = useState(0);
  const [slabDetails, setSlabDetails] = useState<Record<string, Slab>>({});
  const [processDate, setProcessDate] = useState(todayIst());
  const [slabLoading, setSlabLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingProcess, setPendingProcess] = useState<{
    id: string;
    processType: string;
  } | null>(null);
  const [slabs, setSlabs] = useState<Slab[]>([]);
  const [polishMachine, setPolishMachine] = useState("");
  const [polishBlock, setPolishBlock] = useState("");
  const [due, setDue] = useState(0);
  const [selectedSlabs, setSelectedSlabs] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const { items, refresh: refreshQueue } = useOutbox();

  async function refresh() {
    const [m, b, s] = await Promise.all([
      apiFetch<Machine[]>("/api/v1/machines"),
      apiFetch<Block[]>("/api/v1/inventory/raw-blocks"),
      apiFetch<Session[]>("/api/v1/cutting-sessions"),
    ]);
    setMachines(m);
    setBlocks(b.filter((b) => !/^BAD-(ZERO|NEG)$/.test(b.serialNumber)));
    apiFetch<any[]>("/api/v1/maintenance/alerts")
      .then((j) => setDue(j.length))
      .catch(() => undefined);
    setSessions(s);
    setMachine(
      (current) =>
        current || m.find((row) => row.machineType === "CUTTING")?.id || "",
    );
    const lpm =
      m.find((row) => row.machineType === "POLISHING") ??
      m.find((row) => row.name === "LPM");
    setPolishMachine((current) => current || lpm?.id || "");
  }
  useEffect(() => {
    refresh().catch(() => undefined);
  }, []);

  useEffect(() => {
    let active = true;
    setSlabs([]);
    setSlabLoading(false);
    setSlabTotal(0);
    if (!polishBlock || polishBlock.startsWith("@ref:")) return;
    setSlabLoading(true);
    const query = new URLSearchParams({
      parentBlockId: polishBlock,
      salesStatus: "in_stock",
      page: String(slabPage),
      pageSize: "100",
      q: slabSearch,
    });
    const timer = setTimeout(() => {
      apiFetch<{ items: Slab[]; total: number }>(
        `/api/v1/inventory/slabs?${query}`,
      )
        .then((result) => {
          if (active) {
            setSlabs(result.items);
            setSlabTotal(result.total);
            setSlabDetails((current) => ({
              ...current,
              ...Object.fromEntries(result.items.map((s) => [s.id, s])),
            }));
          }
        })
        .catch((err) => {
          if (active)
            setError(
              err instanceof Error ? err.message : "Could not load slabs",
            );
        })
        .finally(() => {
          if (active) setSlabLoading(false);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [polishBlock, slabPage, slabSearch, notice]);

  // Work done on this phone that the server has not seen yet.
  const queuedBlocks = queuedAt(items, "/api/v1/inventory/raw-blocks");
  const queuedStarts = queuedAt(items, "/api/v1/cutting-sessions");
  const queuedCompletes = queuedAt(
    items,
    /^\/api\/v1\/cutting-sessions\/[^/]+\/complete$/,
  );
  const completedRefs = new Set(
    queuedCompletes.map((c) => c.path.split("/")[4]),
  );
  const serialFor = (blockId: string) => {
    const known = blocks.find((b) => b.id === blockId);
    if (known) return known.serialNumber;
    const queued = queuedBlocks.find(
      (q) => ref(q.clientOpId, "block.id") === blockId,
    );
    return queued
      ? bodyOf<{ serialNumber: string }>(queued).serialNumber
      : "block";
  };

  const allocatedBlocks = new Set(
    queuedStarts.map((q) => bodyOf<{ rawBlockId: string }>(q).rawBlockId),
  );
  const blockChoices: Choice[] = [
    ...blocks
      .filter(
        (b) =>
          (!b.currentStatus || b.currentStatus === "in_stock") &&
          !allocatedBlocks.has(b.id),
      )
      .map((b) => ({ value: b.id, label: b.serialNumber })),
    ...queuedBlocks
      .filter(
        (q) =>
          !allocatedBlocks.has(ref(q.clientOpId, "block.id")) &&
          !/^BAD-(ZERO|NEG)$/.test(
            bodyOf<{ serialNumber: string }>(q).serialNumber,
          ),
      )
      .map((q) => ({
        value: ref(q.clientOpId, "block.id"),
        label: bodyOf<{ serialNumber: string }>(q).serialNumber,
        pending: true,
      })),
  ];
  const openSessions: Choice[] = [
    ...sessions
      .filter(
        (s) =>
          s.status === "IN_PROGRESS" &&
          !completedRefs.has(s.id) &&
          !/^BAD-(ZERO|NEG)$/.test(s.rawBlock.serialNumber),
      )
      .map((s) => ({ value: s.id, label: s.rawBlock.serialNumber })),
    ...queuedStarts
      .filter(
        (q) =>
          !completedRefs.has(ref(q.clientOpId)) &&
          !/^BAD-(ZERO|NEG)$/.test(
            serialFor(bodyOf<{ rawBlockId: string }>(q).rawBlockId),
          ),
      )
      .map((q) => ({
        value: ref(q.clientOpId),
        label: serialFor(bodyOf<{ rawBlockId: string }>(q).rawBlockId),
        pending: true,
      })),
  ];
  const slabChoices: Choice[] = [
    ...slabs
      .filter(
        (s) => s.parentBlockId === polishBlock && s.salesStatus === "in_stock",
      )
      .map((s) => ({
        value: s.id,
        label: slabLabel(s),
        count: 1,
        area: slabSqft(s),
      })),
    ...queuedCompletes
      .filter((q) => {
        const sessionId = q.path.split("/")[4];
        const session = sessions.find((s) => s.id === sessionId);
        if (session)
          return (
            session.rawBlock.serialNumber ===
            blocks.find((b) => b.id === polishBlock)?.serialNumber
          );
        const start = queuedStarts.find((q) => ref(q.clientOpId) === sessionId);
        return Boolean(
          start &&
          bodyOf<{ rawBlockId: string }>(start).rawBlockId === polishBlock,
        );
      })
      .map((q) => ({
        value: ref(q.clientOpId, "slabs[*].id"),
        label: `All ${bodyOf<{ finalGoodSlabCount: number }>(q).finalGoodSlabCount} slabs from a cut not synced yet`,
        pending: true,
        count: bodyOf<{ finalGoodSlabCount: number }>(q).finalGoodSlabCount,
        area: (() => {
          const b = bodyOf<{
            finalGoodSlabCount: number;
            lengthFt?: number;
            widthFt?: number;
          }>(q);
          return b.lengthFt && b.widthFt
            ? b.finalGoodSlabCount * b.lengthFt * b.widthFt
            : null;
        })(),
      })),
  ];
  const effectiveBlock = rawBlockId || blockChoices[0]?.value || "";

  function report(result: unknown, done: string) {
    setError("");
    setNotice(
      isQueued(result)
        ? `${done} — saved on this phone, will sync when online.`
        : `${done}.`,
    );
  }

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setNotice("");
      setError(err instanceof Error ? err.message : "Could not save");
    }
    await Promise.all([refresh().catch(() => undefined), refreshQueue()]);
    setBusy(false);
  }

  async function start(event: FormEvent) {
    event.preventDefault();
    const serial =
      blockChoices.find((b) => b.value === effectiveBlock)?.label ?? "block";
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
    if (
      !Number.isSafeInteger(Number(total)) ||
      !Number.isSafeInteger(Number(good)) ||
      Number(total) < 1 ||
      Number(good) < 0 ||
      Number(good) > Number(total) ||
      !lengthFt ||
      !widthFt ||
      Number(lengthFt) <= 0 ||
      Number(widthFt) <= 0
    ) {
      setReviewCut(false);
      setError(
        "Enter whole slab counts and positive dimensions before completing this session.",
      );
      return;
    }
    await run(async () => {
      const result = await apiFetch(
        `/api/v1/cutting-sessions/${session.value}/complete`,
        {
          method: "POST",
          label: `Complete cutting ${session.label} (${good} good of ${total})`,
          body: JSON.stringify({
            totalSlabsCut: Number(total),
            finalGoodSlabCount: Number(good),
            lengthFt: Number(lengthFt),
            widthFt: Number(widthFt),
            thicknessMm: Number(thicknessMm),
            occurredAt: productionTimestamp(cutDate),
          }),
        },
      );
      report(result, `Cutting completed for ${session.label}`);
      setCompletionSession("");
      setReviewCut(false);
      setTotal("");
      setGood("");
      setLengthFt("");
      setWidthFt("");
    });
  }

  async function polish() {
    if (selectedSlabs.length === 0) return;
    await run(async () => {
      // Name the polishing run up front so its completion can follow it offline.
      let sessionId = pendingProcess?.id;
      const recordedProcess = pendingProcess?.processType ?? processType;
      if (!sessionId) {
        const startOp = newOpId();
        const started = await apiFetch<{ id: string }>(
          "/api/v1/polishing-sessions",
          {
            method: "POST",
            label: "Start polishing",
            body: JSON.stringify({
              clientOpId: startOp,
              machineId: polishMachine,
              processType,
              occurredAt: productionTimestamp(processDate),
              slabIds: selectedSlabs,
              ...(processType === "POLISHING" ? { finishType } : {}),
            }),
          },
        );
        sessionId = isQueued(started) ? ref(startOp) : started.id;
        setPendingProcess({ id: sessionId, processType });
      }
      const finished = await apiFetch(
        `/api/v1/polishing-sessions/${sessionId}/complete`,
        {
          method: "POST",
          label: "Finish polishing",
          body: JSON.stringify({}),
        },
      );
      setSelectedSlabs([]);
      setPendingProcess(null);
      report(
        finished,
        `${recordedProcess === "GRINDING" ? "Grinding" : recordedProcess === "RESIN" ? "Resin" : "Polishing"} recorded`,
      );
    });
  }

  const selectedStats = selectedSlabs.map((id) => {
    const batch = slabChoices.find((s) => s.value === id && s.pending);
    if (batch) return { count: batch.count ?? 0, area: batch.area ?? null };
    return {
      count: 1,
      area: slabDetails[id] ? slabSqft(slabDetails[id]) : null,
    };
  });
  const selectedPieceCount = selectedStats.reduce(
    (sum, row) => sum + row.count,
    0,
  );
  const selectedArea = selectedStats.reduce(
    (sum, row) => sum + (row.area ?? 0),
    0,
  );
  const unknownAreas = selectedStats
    .filter((row) => row.area === null)
    .reduce((sum, row) => sum + row.count, 0);
  const completionBlock = blocks.find(
    (b) =>
      b.serialNumber ===
      openSessions.find((s) => s.value === completionSession)?.label,
  );
  const recovery =
    Number(completionBlock?.weightTons) > 0
      ? (Number(good) * Number(lengthFt) * Number(widthFt)) /
        Number(completionBlock?.weightTons)
      : null;

  const pendingTag = (c: Choice) => (c.pending ? " · not synced" : "");

  return (
    <AppShell>
      <h1>Cut</h1>
      {due > 0 && (
        <p>
          <Link className="chip" href="/maintenance">
            Maintenance due · {due}
          </Link>
        </p>
      )}
      {notice ? (
        <p className="muted" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="card">
        <h2>Start cutting session</h2>
        <form onSubmit={start}>
          <label>
            Block
            <select
              value={effectiveBlock}
              onChange={(e) => setBlock(e.target.value)}
            >
              {blockChoices.length === 0 ? (
                <option value="">No block in the yard</option>
              ) : null}
              {blockChoices.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                  {pendingTag(b)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Machine
            <select
              value={machineId}
              onChange={(e) => setMachine(e.target.value)}
            >
              {machines
                .filter((m) => m.machineType === "CUTTING")
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={busy || !effectiveBlock || !machineId}
          >
            Allocate to saw
          </button>
        </form>
      </div>
      <div className="card">
        <h2>Complete cutting</h2>
        {openSessions.length === 0 ? (
          <EmptyState>
            No cutting session in progress. Allocate a block to the saw first.
          </EmptyState>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!reviewCut) {
                setReviewCut(true);
                return;
              }
              const session = openSessions.find(
                (s) => s.value === completionSession,
              );
              if (session) void complete(session);
            }}
          >
            <label>
              Session
              <select
                required
                value={completionSession}
                onChange={(e) => {
                  setCompletionSession(e.target.value);
                  setTotal("");
                  setGood("");
                  setLengthFt("");
                  setWidthFt("");
                  setReviewCut(false);
                }}
              >
                <option value="">Select the block being completed</option>
                {openSessions.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                    {pendingTag(s)}
                  </option>
                ))}
              </select>
            </label>
            <fieldset disabled={reviewCut || !completionSession}>
              <legend>Count and dimensions for this session</legend>
              <div className="grid">
                <label>
                  Total cut
                  <input
                    required
                    min="1"
                    step="1"
                    type="number"
                    inputMode="numeric"
                    value={total}
                    onChange={(e) => setTotal(e.target.value)}
                  />
                </label>
                <label>
                  Good slabs
                  <input
                    required
                    min="0"
                    max={total || undefined}
                    step="1"
                    type="number"
                    inputMode="numeric"
                    value={good}
                    onChange={(e) => setGood(e.target.value)}
                  />
                </label>
                <label>
                  Length (ft)
                  <input
                    required
                    min="0.01"
                    step="0.01"
                    type="number"
                    inputMode="decimal"
                    value={lengthFt}
                    onChange={(e) => setLengthFt(e.target.value)}
                  />
                </label>
                <label>
                  Width (ft)
                  <input
                    required
                    min="0.01"
                    step="0.01"
                    type="number"
                    inputMode="decimal"
                    value={widthFt}
                    onChange={(e) => setWidthFt(e.target.value)}
                  />
                </label>
                <label>
                  Thickness (mm)
                  <input
                    required
                    min="1"
                    step="1"
                    type="number"
                    value={thicknessMm}
                    onChange={(e) => setThicknessMm(e.target.value)}
                  />
                </label>
                <label>
                  Completion date
                  <input
                    required
                    type="date"
                    min={earliestProductionDate()}
                    max={todayIst()}
                    value={cutDate}
                    onChange={(e) => setCutDate(e.target.value)}
                  />
                </label>
              </div>
              <p className="muted">
                Dimensions apply to every good slab in this cutting session. Use
                a date within the last 14 calendar days; older entries require a
                correction.
              </p>
            </fieldset>
            {reviewCut && (
              <div role="status">
                <h3>Review before saving</h3>
                <p>
                  Block{" "}
                  {
                    openSessions.find((s) => s.value === completionSession)
                      ?.label
                  }
                  : {total} cut  /  {good} good  /  {Number(total) - Number(good)}{" "}
                  damaged.
                </p>
                <p>
                  {lengthFt}  /  {widthFt} ft  /  {thicknessMm} mm  / {" "}
                  {(
                    Number(good) *
                    Number(lengthFt) *
                    Number(widthFt)
                  ).toLocaleString("en-IN")}{" "}
                  sq ft good output  /  {cutDate}.
                </p>
                {recovery !== null && (
                  <p>Recovery: {recovery.toFixed(1)} sq ft per ton.</p>
                )}
                <p>
                  Confirm the counts and dimensions against the saw register.
                </p>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setReviewCut(false)}
                >
                  Edit counts
                </button>
              </div>
            )}
            <button type="submit" disabled={busy || !completionSession}>
              {reviewCut
                ? "Confirm cutting completion"
                : "Review cutting completion"}
            </button>
          </form>
        )}
      </div>
      <div className="card">
        <h2>Grinding, resin and polishing</h2>
        {pendingProcess && (
          <p role="alert">
            This process has started. Retry completion to finish the same
            session before recording another batch.
          </p>
        )}
        <fieldset disabled={busy || pendingProcess !== null}>
          <legend>Process batch</legend>
          <label>
            Block
            <select
              value={polishBlock}
              onChange={(e) => {
                setPolishBlock(e.target.value);
                setSelectedSlabs([]);
                setSlabPage(1);
                setSlabSearch("");
                setSlabTotal(0);
              }}
            >
              <option value="">Select block first</option>
              {[
                ...blocks.map((b) => ({ value: b.id, label: b.serialNumber })),
                ...queuedBlocks.map((q) => ({
                  value: ref(q.clientOpId, "block.id"),
                  label: bodyOf<{ serialNumber: string }>(q).serialNumber,
                })),
              ].map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            LPM
            <select
              value={polishMachine}
              onChange={(e) => setPolishMachine(e.target.value)}
            >
              {machines
                .filter((m) => m.machineType === "POLISHING")
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Process
            <select
              value={processType}
              onChange={(e) => setProcessType(e.target.value)}
            >
              <option value="GRINDING">Grinding</option>
              <option value="RESIN">Resin application</option>
              <option value="POLISHING">Final polishing</option>
            </select>
          </label>
          {processType === "POLISHING" && (
            <label>
              Finish
              <select
                value={finishType}
                onChange={(e) => setFinishType(e.target.value)}
              >
                <option value="glossy">Glossy / mirror</option>
                <option value="honed">Honed</option>
                <option value="leather">Leather</option>
              </select>
            </label>
          )}
          <label>
            Process date
            <input
              type="date"
              required
              min={earliestProductionDate()}
              max={todayIst()}
              value={processDate}
              onChange={(e) => setProcessDate(e.target.value)}
            />
          </label>
          <label>
            Search slabs in this block
            <input
              type="search"
              value={slabSearch}
              disabled={!polishBlock}
              onChange={(e) => {
                setSlabSearch(e.target.value);
                setSlabPage(1);
              }}
            />
          </label>
          <p role="status">
            {slabLoading
              ? "Loading slabs / "
              : `${slabTotal} available slabs in this search.`}{" "}
            {selectedPieceCount} slabs selected
            {selectedSlabs.some((id) => id.includes("slabs[*]"))
              ? " (including unsynced batches)"
              : ""}
            .
          </p>
          <p>
            {selectedArea.toLocaleString("en-IN")} sq ft selected
            {unknownAreas
              ? `  /  ${unknownAreas} selection(s) have unknown area or unsynced batch dimensions`
              : ""}
            .
          </p>
          <p className="muted">
            Select only the slabs that completed this process. Grinding and
            resin do not move stock into finished goods.
          </p>
          <div
            className="batch-list"
            style={{
              maxHeight: "22rem",
              overflowY: "auto",
              border: "1px solid var(--border, #ddd)",
              padding: "0.75rem",
            }}
          >
            {slabChoices.length > 0 && (
              <button
                className="secondary"
                type="button"
                onClick={() =>
                  setSelectedSlabs((current) =>
                    Array.from(
                      new Set([...current, ...slabChoices.map((s) => s.value)]),
                    ),
                  )
                }
              >
                Select this page
              </button>
            )}
            {slabChoices.map((s) => (
              <label
                key={s.value}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "0.5rem",
                  overflowWrap: "anywhere",
                }}
              >
                <input
                  type="checkbox"
                  style={{ width: "auto", flexShrink: 0 }}
                  checked={selectedSlabs.includes(s.value)}
                  onChange={(e) =>
                    setSelectedSlabs((current) =>
                      e.target.checked
                        ? [...current, s.value]
                        : current.filter((id) => id !== s.value),
                    )
                  }
                />
                <span>
                  {s.label}
                  {pendingTag(s)}
                </span>
              </label>
            ))}
            {!slabLoading && slabChoices.length === 0 && (
              <p className="muted">
                {polishBlock
                  ? "No available slabs match this search."
                  : "Select a block to load its slabs."}
              </p>
            )}
          </div>
          {slabTotal > 100 && (
            <p>
              <button
                className="secondary"
                type="button"
                disabled={slabPage === 1 || slabLoading}
                onClick={() => setSlabPage((p) => p - 1)}
              >
                Previous slabs
              </button>{" "}
              Page {slabPage} of {Math.ceil(slabTotal / 100)}{" "}
              <button
                className="secondary"
                type="button"
                disabled={slabPage * 100 >= slabTotal || slabLoading}
                onClick={() => setSlabPage((p) => p + 1)}
              >
                Next slabs
              </button>
            </p>
          )}
          <p>
            <button
              className="secondary"
              type="button"
              disabled={!selectedSlabs.length}
              onClick={() => setSelectedSlabs([])}
            >
              Clear selection
            </button>
          </p>
        </fieldset>
        <button
          type="button"
          disabled={
            busy ||
            selectedSlabs.length === 0 ||
            !polishMachine ||
            !processDate ||
            processDate > todayIst() ||
            processDate < earliestProductionDate()
          }
          onClick={polish}
        >
          {pendingProcess ? "Retry completion: " : "Record "}{" "}
          {processType === "GRINDING"
            ? "grinding"
            : processType === "RESIN"
              ? "resin"
              : "final polishing"}{" "}
          for selected slabs
        </button>
      </div>
    </AppShell>
  );
}
