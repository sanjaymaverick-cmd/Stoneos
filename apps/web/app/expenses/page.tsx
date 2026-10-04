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
  taxableAmount: string | number | null;
  allocations: Array<{
    rawBlockId: string;
    allocatedAmount: string | number;
    costComponent: string;
  }>;
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
  const [search, setSearch] = useState("");
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
      {!readOnly && (
        <section className="card">
          <h2>Block costs belong with the block</h2>
          <p>
            Review purchase, royalty, transport and linked expenses together in
            Yard.
          </p>
          <Link className="button secondary" href="/inventory?view=costs">
            Open Yard block costs →
          </Link>
        </section>
      )}
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
          <h2>Record a general expense</h2>
          <p>
            For a block cost, use Yard so the expense and block link are
            recorded together.
          </p>
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
      <h2>Expense register</h2>
      <label>
        Find an expense
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Paid to, date, category or block"
        />
      </label>
      {items.length === 0 ? (
        <EmptyState>
          No expenses yet. Record diesel, wages, or other costs above.
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Category</th>
                <th>Paid to</th>
                <th className="num">Amount paid</th>
                <th>Block / cost link</th>
                <th>Unallocated before GST</th>
              </tr>
            </thead>
            <tbody>
              {items
                .filter((i) =>
                  [
                    i.toWhom,
                    i.category,
                    i.expenseDate,
                    ...(i.allocations ?? []).map(
                      (a) =>
                        blocks.find((b) => b.id === a.rawBlockId)?.serialNumber,
                    ),
                  ]
                    .join(" ")
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((i) => (
                  <tr id={"expense-" + i.id} key={i.id}>
                    <td>{i.expenseDate?.slice(0, 10)}</td>
                    <td>
                      {i.category}
                      {i.vehicle ? ` · ${i.vehicle.name}` : ""}
                    </td>
                    <td>{i.toWhom ?? ""}</td>
                    <td className="num">{formatInr(Number(i.amount))}</td>
                    <td>
                      {i.allocations?.map((a, j) => (
                        <div key={j}>
                          <Link
                            href={"/inventory?view=costs&block=" + a.rawBlockId}
                          >
                            {blocks.find((b) => b.id === a.rawBlockId)
                              ?.serialNumber ?? "Block"}{" "}
                            ·{" "}
                            {a.costComponent === "royalty"
                              ? "Royalty"
                              : a.costComponent === "block_transport"
                                ? "Transport"
                                : "Other"}{" "}
                            · {formatInr(Number(a.allocatedAmount))} →
                          </Link>
                        </div>
                      ))}
                    </td>
                    <td>
                      {formatInr(
                        Math.max(
                          0,
                          Math.round(
                            Number(i.taxableAmount ?? i.amount) * 100,
                          ) -
                            (i.allocations ?? []).reduce(
                              (n, a) =>
                                n + Math.round(Number(a.allocatedAmount) * 100),
                              0,
                            ),
                        ) / 100,
                      )}{" "}
                      {!readOnly &&
                        Number(i.taxableAmount ?? i.amount) -
                          (i.allocations ?? []).reduce(
                            (n, a) => n + Number(a.allocatedAmount),
                            0,
                          ) >
                          0.005 && (
                          <Link href={"/inventory?view=costs&expense=" + i.id}>
                            Review in Yard →
                          </Link>
                        )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
