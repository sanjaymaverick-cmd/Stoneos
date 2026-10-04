"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { apiFetch, isQueued } from "../../lib/api";
import { formatInr, todayIst } from "../../lib/format";

type Expense = {
  id: string;
  category: string;
  amount: string;
  expenseDate: string;
  toWhom: string | null;
  vehicle?: { name: string } | null;
};

export default function ExpensesPage() {
  const [draftText, setDraftText] = useState("");
  const [draftNotice, setDraftNotice] = useState("");
  const [balances, setBalances] = useState<{
    youllGet: number;
    youllGive: number;
    net: number;
    parties: Array<{
      id: string;
      name: string;
      kind: string;
      youllGet: number;
      youllGive: number;
    }>;
  } | null>(null);
  const [collected, setCollected] = useState<number | null>(null);
  const [readOnly, setReadOnly] = useState(true);
  const [blocks, setBlocks] = useState<
    Array<{ id: string; serialNumber: string }>
  >([]);
  const [items, setItems] = useState<Expense[]>([]);
  const [category, setCategory] = useState("diesel");
  const [amount, setAmount] = useState("1000");
  const [expenseDate, setExpenseDate] = useState(todayIst());
  const [toWhom, setToWhom] = useState("");
  const [vehicles, setVehicles] = useState<Array<{ id: string; name: string }>>(
    [],
  );
  const [vehicleId, setVehicleId] = useState("");
  const [vehicleName, setVehicleName] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    const me = await apiFetch<{ role: string }>("/api/v1/auth/me");
    setReadOnly(["accountant", "auditor"].includes(me.role));
    setBalances(await apiFetch("/api/v1/books/outstanding"));
    const today = await apiFetch<{ collected: number }>(
      "/api/v1/books/collections-today",
    );
    setCollected(today.collected);
    setItems(await apiFetch("/api/v1/expenses"));
    setBlocks(await apiFetch("/api/v1/inventory/raw-blocks"));
    const v = await apiFetch<Array<{ id: string; name: string }>>(
      "/api/v1/expenses/vehicles",
    ).catch(() => []);
    setVehicles(v);
  }
  useEffect(() => {
    refresh().catch(() => undefined);
  }, []);

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
      setNotice(
        isQueued(result)
          ? "Saved on this phone; it syncs when online."
          : "Expense recorded.",
      );
      setToWhom("");
    } catch (err) {
      setNotice("");
      setError(
        err instanceof Error ? err.message : "Could not record the expense",
      );
    }
    await refresh().catch(() => undefined);
  }

  return (
    <AppShell>
      <h1>Money</h1>
      <p>
        <Link href="/sales/reports">
          Customer and supplier statements, payments and dues →
        </Link>
      </p>
      <div className="grid">
        <div className="metric ok">
          <span>Collected today</span>
          <b>{collected === null ? "…" : formatInr(collected)}</b>
        </div>
        <div className="metric bad">
          <span>You’ll get</span>
          <b>{balances ? formatInr(balances.youllGet) : "…"}</b>
        </div>
        <div className="metric">
          <span>You’ll give</span>
          <b>{balances ? formatInr(balances.youllGive) : "…"}</b>
        </div>
        <div className="metric">
          <span>Net</span>
          <b>{balances ? formatInr(balances.net) : "…"}</b>
        </div>
      </div>
      <section className="card">
        <h2>Customer and supplier balances</h2>
        {balances?.parties.map((p) => (
          <p key={p.id}>
            <span>{p.name}</span> · {p.kind} ·{" "}
            {p.youllGet > 0
              ? `you’ll get ${formatInr(p.youllGet)}`
              : `you’ll give ${formatInr(p.youllGive)}`}
          </p>
        ))}
      </section>
      <details className="card">
        <summary>Archive</summary>
        <p>
          <Link href="/books/rokad">Rokad</Link> ·{" "}
          {!readOnly && <Link href="/books/import">Import</Link>} ·{" "}
          <Link href="/books/gst">GST</Link> ·{" "}
          {!readOnly && <Link href="/tally">Tally archive</Link>} ·{" "}
        </p>
        {!readOnly && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await apiFetch("/api/v1/books/copilot/propose", {
                  method: "POST",
                  body: JSON.stringify({ text: draftText }),
                });
                setDraftNotice(
                  "Draft classified. No payment or invoice posted.",
                );
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Could not classify draft",
                );
              }
            }}
          >
            <label>
              Draft classifier
              <textarea
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                required
              />
            </label>
            <button className="secondary" type="submit">
              Classify draft
            </button>
            {draftNotice && <p role="status">{draftNotice}</p>}
          </form>
        )}
      </details>
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
      {!readOnly && (
        <div className="card">
          <form onSubmit={onSubmit}>
            <label>
              Category
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option>diesel</option>
                <option>electricity</option>
                <option>wages</option>
                <option>vehicle</option>
                <option>consumables</option>
                <option>maintenance</option>
                <option>transport</option>
                <option>other</option>
              </select>
            </label>
            <label>
              Amount (₹)
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </label>
            <label>
              Date
              <input
                type="date"
                value={expenseDate}
                max={todayIst()}
                onChange={(e) => setExpenseDate(e.target.value)}
                required
              />
            </label>
            <label>
              Paid to
              <input
                value={toWhom}
                onChange={(e) => setToWhom(e.target.value)}
                placeholder="Pump, supplier, person"
              />
            </label>
            <label>
              Vehicle
              <select
                value={vehicleId}
                onChange={(e) => setVehicleId(e.target.value)}
                required={category === "vehicle"}
              >
                <option value="">None</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">Record</button>
          </form>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await apiFetch("/api/v1/expenses/vehicles", {
                method: "POST",
                body: JSON.stringify({ name: vehicleName }),
              });
              setVehicleName("");
              await refresh();
            }}
          >
            <label>
              New vehicle
              <input
                value={vehicleName}
                onChange={(e) => setVehicleName(e.target.value)}
                required
              />
            </label>
            <button type="submit" className="secondary">
              Add vehicle
            </button>
          </form>
        </div>
      )}
      {items.length === 0 ? (
        <EmptyState>
          No expenses yet. Record diesel, wages, or other costs above.
        </EmptyState>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Category</th>
              <th>Paid to</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.slice(0, 10).map((i) => (
              <tr key={i.id}>
                <td>{i.expenseDate?.slice(0, 10)}</td>
                <td>
                  {i.category}
                  {i.vehicle ? ` · ${i.vehicle.name}` : ""}
                </td>
                <td>{i.toWhom ?? ""}</td>
                <td className="num">{formatInr(Number(i.amount))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!readOnly && (
        <section className="card">
          <h2>Allocate an expense to a block</h2>
          <p>
            Allocate the amount before GST. Royalty and block transport
            allocations fulfil the per-ton costs in Business insights; they are
            counted once.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const f = new FormData(event.currentTarget);
              setError("");
              apiFetch("/api/v1/expenses/" + f.get("expense") + "/allocate", {
                method: "POST",
                body: JSON.stringify({
                  batchKey: crypto.randomUUID(),
                  allocations: [
                    {
                      rawBlockId: f.get("block"),
                      allocatedAmount: Number(f.get("amount")),
                      costComponent: f.get("component"),
                    },
                  ],
                }),
              })
                .then(() => {
                  setNotice("Expense allocated.");
                  refresh();
                })
                .catch((e) => setError(e.message));
            }}
          >
            <label>
              Expense
              <select name="expense" required>
                <option value="">Choose expense</option>
                {items.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.expenseDate.slice(0, 10)} · {e.category} ·{" "}
                    {formatInr(Number(e.amount))} · {e.toWhom}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Block
              <select name="block" required>
                <option value="">Choose block</option>
                {blocks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.serialNumber}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Cost component
              <select name="component">
                <option value="other">Other block expense</option>
                <option value="royalty">Block royalty</option>
                <option value="block_transport">Block transport rent</option>
              </select>
            </label>
            <label>
              Amount before GST (₹)
              <input
                type="number"
                name="amount"
                min="0.01"
                step="0.01"
                required
              />
            </label>
            <button>Allocate expense</button>
          </form>
        </section>
      )}
    </AppShell>
  );
}
