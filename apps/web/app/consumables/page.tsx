"use client";

import { FormEvent, useEffect, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { apiFetch } from "../../lib/api";

export default function ConsumablesPage() {
  const [items, setItems] = useState<Array<{ id: string; name: string; unit: string; onHand: string }>>([]);
  const [name, setName] = useState("Abrasive brick");
  const [unit, setUnit] = useState("pcs");
  const [onHand, setOnHand] = useState("96");

  async function refresh() {
    setItems(await apiFetch("/api/v1/consumables"));
  }
  useEffect(() => { refresh().catch(() => undefined); }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await apiFetch("/api/v1/consumables", {
      method: "POST",
      body: JSON.stringify({ name, unit, onHand: Number(onHand) }),
    });
    await refresh();
  }

  return (
    <AppShell>
      <h1>Consumables</h1>
      <div className="card">
        <form onSubmit={onSubmit}>
          <label>Name<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
          <label>Unit<input value={unit} onChange={(e) => setUnit(e.target.value)} required /></label>
          <label>On hand<input value={onHand} onChange={(e) => setOnHand(e.target.value)} /></label>
          <button type="submit">Add</button>
        </form>
      </div>
      <ul>{items.map((i) => <li key={i.id}>{i.name} — {i.onHand} {i.unit}</li>)}</ul>
    </AppShell>
  );
}
