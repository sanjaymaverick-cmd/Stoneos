"use client";

import { FormEvent, useEffect, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { apiFetch } from "../../lib/api";

export default function ExpensesPage() {
  const [items, setItems] = useState<Array<{ id: string; category: string; amount: string }>>([]);
  const [category, setCategory] = useState("diesel");
  const [amount, setAmount] = useState("1000");
  const [vehicles, setVehicles] = useState<Array<{ id: string; name: string }>>([]);
  const [vehicleId, setVehicleId] = useState("");
  const [vehicleName, setVehicleName] = useState("");

  async function refresh() {
    setItems(await apiFetch("/api/v1/expenses"));
    const v = await apiFetch<Array<{ id: string; name: string }>>("/api/v1/expenses/vehicles").catch(() => []);
    setVehicles(v);
    if (!vehicleId && v[0]) setVehicleId(v[0].id);
  }
  useEffect(() => { refresh().catch(() => undefined); }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await apiFetch("/api/v1/expenses", {
      method: "POST",
      body: JSON.stringify({
        category,
        amount: Number(amount),
        expenseDate: new Date().toISOString().slice(0, 10),
        vehicleId: category === "vehicle" ? vehicleId : undefined,
        clientOpId: crypto.randomUUID(),
      }),
    });
    await refresh();
  }

  return (
    <AppShell>
      <h1>Expenses</h1>
      <div className="card">
        <form onSubmit={onSubmit}>
          <label>Category
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option>diesel</option><option>electricity</option><option>wages</option><option>vehicle</option><option>other</option>
            </select>
          </label>
          <label>Amount<input value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <label>Vehicle
            <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">None</option>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </label>
          <button type="submit">Record</button>
        </form>
        <form onSubmit={async (e) => { e.preventDefault(); await apiFetch("/api/v1/expenses/vehicles", { method: "POST", body: JSON.stringify({ name: vehicleName }) }); setVehicleName(""); await refresh(); }}>
          <label>New vehicle<input value={vehicleName} onChange={(e) => setVehicleName(e.target.value)} required /></label>
          <button type="submit" className="secondary">Add vehicle</button>
        </form>
      </div>
      {items.length === 0 ? (
        <EmptyState>No expenses yet. Record diesel, wages, or other costs above.</EmptyState>
      ) : (
        <ul>{items.map((i) => <li key={i.id}>{i.category} — {i.amount}</li>)}</ul>
      )}
    </AppShell>
  );
}
