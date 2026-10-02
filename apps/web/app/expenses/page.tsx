"use client";

import { FormEvent, useEffect, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { apiFetch, isQueued } from "../../lib/api";
import { formatInr, todayIst } from "../../lib/format";

type Expense = { id: string; category: string; amount: string; expenseDate: string; toWhom: string | null; vehicle?: { name: string } | null };

export default function ExpensesPage() {
  const [items, setItems] = useState<Expense[]>([]);
  const [category, setCategory] = useState("diesel");
  const [amount, setAmount] = useState("1000");
  const [expenseDate, setExpenseDate] = useState(todayIst());
  const [toWhom, setToWhom] = useState("");
  const [vehicles, setVehicles] = useState<Array<{ id: string; name: string }>>([]);
  const [vehicleId, setVehicleId] = useState("");
  const [vehicleName, setVehicleName] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    setItems(await apiFetch("/api/v1/expenses"));
    const v = await apiFetch<Array<{ id: string; name: string }>>("/api/v1/expenses/vehicles").catch(() => []);
    setVehicles(v);
  }
  useEffect(() => { refresh().catch(() => undefined); }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const result = await apiFetch("/api/v1/expenses", {
        method: "POST",
        label: `Expense ${category} ${formatInr(Number(amount))} on ${expenseDate}`,
        body: JSON.stringify({
          category,
          amount: Number(amount),
          expenseDate,
          toWhom: toWhom.trim() || undefined,
          // Diesel bought for a truck is still that truck's cost.
          vehicleId: vehicleId || undefined,
          clientOpId: crypto.randomUUID(),
        }),
      });
      setNotice(isQueued(result) ? "Saved on this phone; it syncs when online." : "Expense recorded.");
      setToWhom("");
    } catch (err) {
      setNotice("");
      setError(err instanceof Error ? err.message : "Could not record the expense");
    }
    await refresh().catch(() => undefined);
  }

  return (
    <AppShell>
      <h1>Expenses</h1>
      {notice ? <p className="muted" role="status">{notice}</p> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      <div className="card">
        <form onSubmit={onSubmit}>
          <label>Category
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option>diesel</option><option>electricity</option><option>wages</option><option>vehicle</option>
              <option>consumables</option><option>maintenance</option><option>transport</option><option>other</option>
            </select>
          </label>
          <label>Amount (₹)<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>
          <label>Date<input type="date" value={expenseDate} max={todayIst()} onChange={(e) => setExpenseDate(e.target.value)} required /></label>
          <label>Paid to<input value={toWhom} onChange={(e) => setToWhom(e.target.value)} placeholder="Pump, supplier, person" /></label>
          <label>Vehicle
            <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} required={category === "vehicle"}>
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
        <table>
          <thead><tr><th>Date</th><th>Category</th><th>Paid to</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td>{i.expenseDate?.slice(0, 10)}</td>
                <td>{i.category}{i.vehicle ? ` · ${i.vehicle.name}` : ""}</td>
                <td>{i.toWhom ?? ""}</td>
                <td className="num">{formatInr(Number(i.amount))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </AppShell>
  );
}
