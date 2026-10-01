"use client";

import { FormEvent, useEffect, useState } from "react";
import { CONSUMABLE_UNITS, type ConsumableUnit } from "@stoneos/contracts";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { apiFetch, isQueued } from "../../lib/api";

export default function ConsumablesPage() {
  const [items, setItems] = useState<Array<{ id: string; name: string; unit: string; onHand: string }>>([]);
  const [name, setName] = useState("Abrasive brick");
  const [unit, setUnit] = useState<ConsumableUnit>("piece");
  const [onHand, setOnHand] = useState("96");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    setItems(await apiFetch("/api/v1/consumables"));
  }
  useEffect(() => { refresh().catch(() => undefined); }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const result = await apiFetch("/api/v1/consumables", {
        method: "POST",
        label: `Consumable ${name}`,
        body: JSON.stringify({ name, unit, onHand: Number(onHand) }),
      });
      setNotice(isQueued(result) ? `${name} saved on this phone; it syncs when online.` : `${name} added.`);
    } catch (err) {
      setNotice("");
      setError(err instanceof Error ? err.message : "Could not add");
    }
    await refresh().catch(() => undefined);
  }

  return (
    <AppShell>
      <h1>Consumables</h1>
      {notice ? <p className="muted" role="status">{notice}</p> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      <div className="card">
        <form onSubmit={onSubmit}>
          <label>Name<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
          <label>Unit
            <select value={unit} onChange={(e) => setUnit(e.target.value as ConsumableUnit)}>
              {CONSUMABLE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>
          <label>On hand<input type="number" inputMode="decimal" min="0" step="any" value={onHand} onChange={(e) => setOnHand(e.target.value)} /></label>
          <button type="submit">Add</button>
        </form>
      </div>
      {items.length === 0 ? (
        <EmptyState>No consumables recorded. Add abrasive, diamond, or other stock above.</EmptyState>
      ) : (
        <ul>{items.map((i) => <li key={i.id}>{i.name} — {Number(i.onHand)} {i.unit}</li>)}</ul>
      )}
    </AppShell>
  );
}
