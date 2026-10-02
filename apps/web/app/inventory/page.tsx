"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { apiFetch, isQueued, pendingRef } from "../../lib/api";
import { bodyOf, queuedAt, useOutbox } from "../../lib/useOutbox";
import { formatInr, slabLabel } from "../../lib/format";

type Slab = {
  id: string;
  slabSerial: string;
  salesStatus: string;
  varietyName?: string | null;
  lengthFt?: string | null;
  widthFt?: string | null;
  thicknessMm?: number | null;
};

export default function InventoryPage() {
  const [blocks, setBlocks] = useState<Array<{ id: string; serialNumber: string; varietyName: string; currentStatus: string }>>([]);
  const [serialNumber, setSerial] = useState("");
  const [varietyName, setVariety] = useState("Kashmir White");
  const [weightTons, setWeightTons] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [quarry, setQuarry] = useState("");
  const [purchaseTaxable, setPurchaseTaxable] = useState("");
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState("");
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const { items, refresh: refreshQueue } = useOutbox();
  const queuedBlocks = queuedAt(items, "/api/v1/inventory/raw-blocks");
  const [slabs, setSlabs] = useState<Slab[]>([]);
  const [supplierName, setSupplierName] = useState("");
  const [movements, setMovements] = useState<Array<{ id: string; movementType: string; rawBlockId: string | null; notes: string | null }>>([]);
  const receiveOp = useRef(crypto.randomUUID());

  async function refresh() {
    setBlocks(await apiFetch("/api/v1/inventory/raw-blocks"));
    setSlabs(await apiFetch("/api/v1/inventory/slabs"));
    setMovements(await apiFetch("/api/v1/inventory/movements"));
    setSuppliers(await apiFetch("/api/v1/inventory/suppliers").catch(() => []));
  }
  useEffect(() => { refresh().catch(() => undefined); }, []);

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
          purchaseTaxable: purchaseTaxable ? Number(purchaseTaxable) : undefined,
          supplierInvoiceNo: supplierInvoiceNo.trim() || undefined,
          clientOpId: receiveOp.current,
        }),
      });
      receiveOp.current = crypto.randomUUID();
      setNotice(
        isQueued(result)
          ? `Block ${serialNumber} saved on this phone (${result.pendingRef}). It can go to the saw now and syncs when online.`
          : `Block ${serialNumber} received (${weightTons} t).`,
      );
      setSerial("");
      setWeightTons("");
      setPurchaseTaxable("");
      setSupplierInvoiceNo("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Receive failed");
    }
    await Promise.all([refresh().catch(() => undefined), refreshQueue()]);
  }

  // Dispatched slabs have left the yard; listing them buries what can still be sold.
  const yardSlabs = slabs.filter((s) => s.salesStatus !== "dispatched");
  const shipped = slabs.length - yardSlabs.length;

  return (
    <AppShell>
      <h1>Inventory</h1>
      <div className="card">
        <h2>Receive raw block</h2>
        <form onSubmit={onSubmit}>
          <label>Serial<input value={serialNumber} onChange={(e) => setSerial(e.target.value)} required /></label>
          <label>Variety<input value={varietyName} onChange={(e) => setVariety(e.target.value)} required /></label>
          <label>Weight (tons)
            <input type="number" inputMode="decimal" step="0.01" min="0.01" max="60" value={weightTons} onChange={(e) => setWeightTons(e.target.value)} required />
          </label>
          <label>Supplier
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Not recorded</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label>Quarry<input value={quarry} onChange={(e) => setQuarry(e.target.value)} placeholder="Pit or location" /></label>
          <label>Value before GST (₹)
            <input type="number" inputMode="decimal" min="0" step="1" value={purchaseTaxable} onChange={(e) => setPurchaseTaxable(e.target.value)} />
          </label>
          {purchaseTaxable && weightTons ? (
            <p className="muted">{formatInr(Number(purchaseTaxable) / Number(weightTons))} per ton · 5% GST on top</p>
          ) : null}
          <label>Supplier bill no.<input value={supplierInvoiceNo} onChange={(e) => setSupplierInvoiceNo(e.target.value)} /></label>
          {error ? <p className="error" role="alert">{error}</p> : null}
          {notice ? <p className="muted" role="status">{notice}</p> : null}
          <button type="submit">Receive</button>
        </form>
        <form onSubmit={async (e) => { e.preventDefault(); await apiFetch("/api/v1/inventory/suppliers", { method: "POST", body: JSON.stringify({ name: supplierName }) }); setSupplierName(""); await refresh().catch(() => undefined); }}>
          <label>New supplier<input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} required /></label>
          <button type="submit" className="secondary">Add supplier</button>
        </form>
      </div>
      <div className="card">
        <h2>Slabs in the yard</h2>
        {yardSlabs.length === 0 ? (
          <EmptyState>No slabs in the yard. Complete a cutting session to stock unpolished pieces.</EmptyState>
        ) : (
          <ul>{yardSlabs.map((s) => <li key={s.id}>{slabLabel(s)} — {s.salesStatus.replace("_", " ")}</li>)}</ul>
        )}
        {shipped ? <p className="muted">{shipped} dispatched slab{shipped === 1 ? "" : "s"} not shown.</p> : null}
      </div>
      <div className="card">
        {blocks.length === 0 && queuedBlocks.length === 0 ? (
          <EmptyState>No raw blocks on hand. Receive a block above to start the yard.</EmptyState>
        ) : (
          <table>
            <thead><tr><th>Serial</th><th>Variety</th><th>Status</th></tr></thead>
            <tbody>
              {queuedBlocks.map((q) => {
                const body = bodyOf<{ serialNumber: string; varietyName: string }>(q);
                return (
                  <tr key={q.clientOpId}>
                    <td>{body.serialNumber}</td>
                    <td>{body.varietyName}</td>
                    <td><span className="pending-tag">not synced · {pendingRef(q.clientOpId)}</span></td>
                  </tr>
                );
              })}
              {blocks.map((b) => (
                <tr key={b.id}><td>{b.serialNumber}</td><td>{b.varietyName}</td><td>{b.currentStatus}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="card">
        <h2>Recent movements</h2>
        {movements.length === 0 ? <EmptyState>No movements yet.</EmptyState> : (
          <ul>
            {movements.slice(0, 12).map((m) => (
              <li key={m.id}>
                {m.movementType}
                {m.movementType === "GOODS_RECEIPT" || m.movementType === "SALES_RESERVATION" || m.movementType === "DELIVERY" ? (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      apiFetch(`/api/v1/inventory/movements/${m.id}/reverse`, {
                        method: "POST",
                        body: JSON.stringify({ reason: "mistype", clientOpId: `rev:${m.id}` }),
                      }).then(refresh)
                    }
                  >
                    Reverse
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
