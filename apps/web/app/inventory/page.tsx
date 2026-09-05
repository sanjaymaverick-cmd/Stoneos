"use client";

import { FormEvent, useEffect, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { apiFetch } from "../../lib/api";

export default function InventoryPage() {
  const [blocks, setBlocks] = useState<Array<{ id: string; serialNumber: string; varietyName: string; currentStatus: string }>>([]);
  const [serialNumber, setSerial] = useState("");
  const [varietyName, setVariety] = useState("Kashmir White");
  const [error, setError] = useState("");
  const [slabs, setSlabs] = useState<Array<{ id: string; slabSerial: string; salesStatus: string }>>([]);
  const [supplierName, setSupplierName] = useState("");

  async function refresh() {
    setBlocks(await apiFetch("/api/v1/inventory/raw-blocks"));
    setSlabs(await apiFetch("/api/v1/inventory/slabs"));
  }
  useEffect(() => { refresh().catch(() => undefined); }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await apiFetch("/api/v1/inventory/raw-blocks", {
        method: "POST",
        body: JSON.stringify({ serialNumber, varietyName, clientOpId: crypto.randomUUID() }),
      });
      setSerial("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Receive failed");
    }
  }

  return (
    <AppShell>
      <h1>Inventory</h1>
      <div className="card">
        <h2>Receive raw block</h2>
        <form onSubmit={onSubmit}>
          <label>Serial<input value={serialNumber} onChange={(e) => setSerial(e.target.value)} required /></label>
          <label>Variety<input value={varietyName} onChange={(e) => setVariety(e.target.value)} required /></label>
          {error ? <p className="error">{error}</p> : null}
          <button type="submit">Receive</button>
        </form>
        <form onSubmit={async (e) => { e.preventDefault(); await apiFetch("/api/v1/inventory/suppliers", { method: "POST", body: JSON.stringify({ name: supplierName }) }); setSupplierName(""); }}>
          <label>Supplier<input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} required /></label>
          <button type="submit" className="secondary">Add supplier</button>
        </form>
      </div>
      <div className="card">
        <h2>Slabs</h2>
        {slabs.length === 0 ? (
          <EmptyState>No slabs yet. Complete a cutting session to stock unpolished pieces.</EmptyState>
        ) : (
          <ul>{slabs.map((s) => <li key={s.id}>{s.slabSerial} — {s.salesStatus}</li>)}</ul>
        )}
      </div>
      <div className="card">
        {blocks.length === 0 ? (
          <EmptyState>No raw blocks on hand. Receive a block above to start the yard.</EmptyState>
        ) : (
          <table>
            <thead><tr><th>Serial</th><th>Variety</th><th>Status</th></tr></thead>
            <tbody>
              {blocks.map((b) => (
                <tr key={b.id}><td>{b.serialNumber}</td><td>{b.varietyName}</td><td>{b.currentStatus}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AppShell>
  );
}
