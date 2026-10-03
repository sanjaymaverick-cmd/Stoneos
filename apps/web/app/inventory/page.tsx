"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { attachFile, Attachments } from "../../components/Attachments";
import { ref } from "../../lib/api";
import { VarietyChips } from "../../components/VarietyChips";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { apiFetch, isQueued } from "../../lib/api";
import { bodyOf, queuedAt, useOutbox } from "../../lib/useOutbox";
import { formatInr, slabLabel, slabSqft } from "../../lib/format";

type Slab = {
  id: string;
  slabSerial: string;
  parentBlockId?: string;
  parentBlock?: { serialNumber: string };
  finish?: string;
  location?: { code: string };
  salesStatus: string;
  varietyName?: string | null;
  lengthFt?: string | null;
  widthFt?: string | null;
  thicknessMm?: number | null;
};

export default function InventoryPage() {
  const [blocks, setBlocks] = useState<
    Array<{
      id: string;
      serialNumber: string;
      varietyName: string;
      currentStatus: string;
      purchaseTaxable?: string | number | null;
      purchaseCashAmount?: string | number | null;
    }>
  >([]);
  const [bill, setBill] = useState<File | null>(null);

  // Correcting a block taken in before the form asked for a cash amount.
  const [fixBlock, setFixBlock] = useState("");
  const [fixCash, setFixCash] = useState("");
  const [fixReason, setFixReason] = useState("");
  const [fixNotice, setFixNotice] = useState("");
  const [fixError, setFixError] = useState("");
  const fixOp = useRef(crypto.randomUUID());
  const [search, setSearch] = useState("");
  const [varietyFilter, setVarietyFilter] = useState("");
  const [finishFilter, setFinishFilter] = useState("");
  const [serialNumber, setSerial] = useState("");
  const [varietyName, setVariety] = useState("Kashmir White");
  const [weightTons, setWeightTons] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [quarry, setQuarry] = useState("");
  const [purchaseTaxable, setPurchaseTaxable] = useState("");
  const [purchaseCash, setPurchaseCash] = useState("");
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState("");
  const [suppliers, setSuppliers] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const { items, refresh: refreshQueue } = useOutbox();
  const queuedBlocks = queuedAt(items, "/api/v1/inventory/raw-blocks");
  const [slabs, setSlabs] = useState<Slab[]>([]);
  const [supplierName, setSupplierName] = useState("");
  const receiveOp = useRef(crypto.randomUUID());

  async function refresh() {
    setBlocks(await apiFetch("/api/v1/inventory/raw-blocks"));
    setSlabs(await apiFetch("/api/v1/inventory/slabs"));
    setSuppliers(await apiFetch("/api/v1/inventory/suppliers").catch(() => []));
  }
  useEffect(() => {
    refresh().catch(() => undefined);
  }, []);

  const numeric = (v: unknown) => Number(v ?? 0) || 0;
  const chosen = blocks.find((b) => b.serialNumber === fixBlock);

  async function correctCash(event: FormEvent) {
    event.preventDefault();
    setFixNotice("");
    setFixError("");
    try {
      const result = (await apiFetch("/api/v1/inventory/raw-blocks/correct-cash", {
        method: "POST",
        label: `Cash on ${fixBlock}`,
        body: JSON.stringify({
          blockSerial: fixBlock,
          purchaseCashAmount: Number(fixCash),
          reason: fixReason.trim(),
          clientOpId: fixOp.current,
        }),
      })) as {
        previousCashAmount?: number;
        costBasis?: number;
        costPerSlab?: number;
        goodSlabCount?: number;
      };
      fixOp.current = crypto.randomUUID();
      setFixNotice(
        isQueued(result)
          ? `Correction to ${fixBlock} saved on this device; it will sync.`
          : `${fixBlock}: cash ${formatInr(result.previousCashAmount ?? 0)} → ` +
            `${formatInr(Number(fixCash))}. Cost basis ${formatInr(result.costBasis ?? 0)}` +
            (result.goodSlabCount
              ? `, ${formatInr(result.costPerSlab ?? 0)} a slab.`
              : " (no cut recorded yet)."),
      );
      setFixCash("");
      setFixReason("");
      await refresh().catch(() => undefined);
    } catch (err) {
      setFixError(err instanceof Error ? err.message : "Correction failed");
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    try {
      const result = await apiFetch("/api/v1/inventory/raw-blocks", {
        method: "POST",
        label: `Receive block ${serialNumber}`,
        body: JSON.stringify({
          serialNumber,
          varietyName,
          weightTons: Number(weightTons),
          supplierId: supplierId || undefined,
          quarry: quarry.trim() || undefined,
          purchaseTaxable: purchaseTaxable
            ? Number(purchaseTaxable)
            : undefined,
          purchaseCashAmount: purchaseCash ? Number(purchaseCash) : undefined,
          supplierInvoiceNo: supplierInvoiceNo.trim() || undefined,
          clientOpId: receiveOp.current,
        }),
      });
      if (bill) {
        await attachFile(
          bill,
          "block",
          isQueued(result)
            ? ref(receiveOp.current, "block.id")
            : result.block.id,
        );
        setBill(null);
      }
      receiveOp.current = crypto.randomUUID();
      setNotice(
        isQueued(result)
          ? `Block ${serialNumber} saved on this phone. It can go to the saw now and syncs when online.`
          : `Block ${serialNumber} received (${weightTons} t).`,
      );
      setSerial("");
      setWeightTons("");
      setPurchaseTaxable("");
      setPurchaseCash("");
      setSupplierInvoiceNo("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Receive failed");
    }
    await Promise.all([refresh().catch(() => undefined), refreshQueue()]);
  }

  const yardSlabs = slabs.filter(
    (s) =>
      (!varietyFilter || s.varietyName === varietyFilter) &&
      (!finishFilter || s.finish === finishFilter) &&
      slabLabel(s).toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <AppShell>
      <h1>Yard</h1>
      <p>
        <Link href="/lots">Lots — stock by block, record a cut, write off breakage →</Link>
      </p>
      <div className="card">
        <h2>Receive raw block</h2>
        <form onSubmit={onSubmit}>
          <label>
            Serial
            <input
              value={serialNumber}
              onChange={(e) => setSerial(e.target.value)}
              required
            />
          </label>
          <label>
            Variety
            <input
              value={varietyName}
              onChange={(e) => setVariety(e.target.value)}
              required
            />
          </label>
          <label>
            Weight (tons)
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              max="60"
              value={weightTons}
              onChange={(e) => setWeightTons(e.target.value)}
              required
            />
          </label>
          <label>
            Supplier
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
            >
              <option value="">Not recorded</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Quarry
            <input
              value={quarry}
              onChange={(e) => setQuarry(e.target.value)}
              placeholder="Pit or location"
            />
          </label>
          <label>
            Value before GST (₹)
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="1"
              value={purchaseTaxable}
              onChange={(e) => setPurchaseTaxable(e.target.value)}
            />
          </label>
          <label>
            Paid in cash, no bill (₹)
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="1"
              value={purchaseCash}
              onChange={(e) => setPurchaseCash(e.target.value)}
            />
          </label>
          <p className="muted">
            Cash carries no GST, so there is no input credit to claim on it — but it
            is still what the stone cost, so it counts towards the cost of every slab
            off this block.
          </p>
          {purchaseTaxable || purchaseCash ? (
            <p className="hint">
              Cost basis {formatInr(Number(purchaseTaxable || 0) + Number(purchaseCash || 0))}
              {weightTons
                ? ` · ${formatInr(
                    (Number(purchaseTaxable || 0) + Number(purchaseCash || 0)) /
                      Number(weightTons),
                  )} per ton`
                : ""}
              {purchaseTaxable ? " · 5% GST on the billed part" : ""}
            </p>
          ) : null}
          <label>
            Supplier bill no.
            <input
              value={supplierInvoiceNo}
              onChange={(e) => setSupplierInvoiceNo(e.target.value)}
            />
          </label>
          <label>
            Optional bill photo
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={(e) => setBill(e.target.files?.[0] ?? null)}
            />
          </label>
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="muted" role="status">
              {notice}
            </p>
          ) : null}
          <button type="submit">Receive</button>
        </form>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await apiFetch("/api/v1/inventory/suppliers", {
              method: "POST",
              body: JSON.stringify({ name: supplierName }),
            });
            setSupplierName("");
            await refresh().catch(() => undefined);
          }}
        >
          <label>
            New supplier
            <input
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              required
            />
          </label>
          <button type="submit" className="secondary">
            Add supplier
          </button>
        </form>
      </div>
      <div className="card">
        <h2>Cash on an older block</h2>
        <p className="muted">
          Blocks taken in before this screen asked for a cash amount carry none, so
          what each of their slabs cost is understated. Put the real figure in here.
          Only the cash part — changing the billed amount would mean amending the
          vendor&apos;s bill and the GST credit claimed on it.
        </p>
        {fixNotice ? <p className="hint">{fixNotice}</p> : null}
        {fixError ? <p className="error">{fixError}</p> : null}
        <form onSubmit={correctCash}>
          <label>
            Block
            <select value={fixBlock} onChange={(e) => setFixBlock(e.target.value)}>
              <option value="">Choose a block</option>
              {blocks.map((b) => (
                <option key={b.id} value={b.serialNumber}>
                  {b.serialNumber} · {b.varietyName} ·{" "}
                  {numeric(b.purchaseCashAmount)
                    ? `${formatInr(numeric(b.purchaseCashAmount))} cash on record`
                    : "no cash recorded"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Cash actually paid (₹)
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="1"
              value={fixCash}
              onChange={(e) => setFixCash(e.target.value)}
            />
          </label>
          <label>
            Why it is being changed
            <input
              value={fixReason}
              onChange={(e) => setFixReason(e.target.value)}
              placeholder="cash leg was never entered at receipt"
            />
          </label>
          <button
            type="submit"
            disabled={!fixBlock || fixCash === "" || !fixReason.trim()}
          >
            Correct it
          </button>
        </form>
        {chosen ? (
          <p className="hint">
            {chosen.serialNumber}: {formatInr(numeric(chosen.purchaseTaxable))} on the
            bill, {formatInr(numeric(chosen.purchaseCashAmount))} cash on record
            {fixCash !== "" ? (
              <>
                {" "}
                → cost basis would become{" "}
                <b>
                  {formatInr(numeric(chosen.purchaseTaxable) + Number(fixCash || 0))}
                </b>
              </>
            ) : null}
            .
          </p>
        ) : null}
        <p className="muted">
          The difference is posted to the books against your name, with the reason.
          Breakage already written off keeps the value it was written off at —
          correcting it now would restate months that may already be filed.
        </p>
      </div>
      <div className="card">
        <h2>Slabs by block</h2>
        <div className="yard-search">
          <label>
            Search
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Block, slab or variety"
            />
          </label>
          <VarietyChips value={varietyFilter} onChange={setVarietyFilter} />
          <label>
            Finish
            <select
              value={finishFilter}
              onChange={(e) => setFinishFilter(e.target.value)}
            >
              <option value="">All finishes</option>
              {Array.from(
                new Set(slabs.map((s) => s.finish).filter(Boolean)),
              ).map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
        </div>
        {yardSlabs.length === 0 ? (
          <EmptyState>
            No slabs in the yard. Complete a cutting session to stock unpolished
            pieces.
          </EmptyState>
        ) : (
          <>
            {Array.from(
              new Set(yardSlabs.map((s) => s.parentBlockId ?? "loose")),
            ).map((id) => (
              <section key={id}>
                <h3>
                  {yardSlabs.find((s) => s.parentBlockId === id)?.parentBlock
                    ?.serialNumber ?? "Loose slabs"}
                </h3>
                <table>
                  <thead>
                    <tr>
                      <th>Slab</th>
                      <th>Size</th>
                      <th>Sqft</th>
                      <th>Thickness</th>
                      <th>Finish</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {yardSlabs
                      .filter((s) => (s.parentBlockId ?? "loose") === id)
                      .map((s, i) => (
                        <tr key={s.id}>
                          <td>
                            {i + 1} · {slabLabel(s).split(" · ")[0]}
                          </td>
                          <td>
                            {s.lengthFt ?? "—"} × {s.widthFt ?? "—"} ft
                          </td>
                          <td>{slabSqft(s) ?? "—"}</td>
                          <td>{s.thicknessMm} mm</td>
                          <td>{s.finish ?? "unpolished"}</td>
                          <td>
                            {s.salesStatus === "in_stock"
                              ? "in yard"
                              : s.salesStatus.replaceAll("_", " ")}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </section>
            ))}
          </>
        )}
      </div>
      <div className="card">
        {blocks.length === 0 && queuedBlocks.length === 0 ? (
          <EmptyState>
            No raw blocks on hand. Receive a block above to start the yard.
          </EmptyState>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Serial</th>
                <th>Variety</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {queuedBlocks.map((q) => {
                const body = bodyOf<{
                  serialNumber: string;
                  varietyName: string;
                }>(q);
                return (
                  <tr key={q.clientOpId}>
                    <td>{body.serialNumber}</td>
                    <td>{body.varietyName}</td>
                    <td>
                      <span className="pending-tag">not synced</span>
                    </td>
                  </tr>
                );
              })}
              {blocks
                .filter((b) => !/^BAD-(ZERO|NEG)$/.test(b.serialNumber))
                .map((b) => (
                  <tr key={b.id}>
                    <td>{b.serialNumber}</td>
                    <td>{b.varietyName}</td>
                    <td>
                      {b.currentStatus === "under_cutting"
                        ? "on saw"
                        : b.currentStatus === "in_stock"
                          ? "in yard"
                          : b.currentStatus.replaceAll("_", " ")}
                      <Attachments type="block" id={b.id} />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>
    </AppShell>
  );
}
