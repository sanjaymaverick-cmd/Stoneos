"use client";

import { FormEvent, useEffect, useState } from "react";
import { CONSUMABLE_UNITS, type ConsumableUnit } from "@stoneos/contracts";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { apiFetch, isQueued } from "../../lib/api";

export default function ConsumablesPage() {
  const [items, setItems] = useState<
    Array<{ id: string; name: string; unit: string; onHand: string }>
  >([]);
  const [name, setName] = useState("Abrasive brick");
  const [unit, setUnit] = useState<ConsumableUnit>("piece");
  const [onHand, setOnHand] = useState("96");
  const [stockId, setStockId] = useState("");
  const [direction, setDirection] = useState("usage");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [moves, setMoves] = useState<
    Array<{
      id: string;
      direction: string;
      quantity: string;
      reason: string;
      occurredOn: string;
      consumable: { name: string; unit: string };
    }>
  >([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    setItems(await apiFetch("/api/v1/consumables"));
    setMoves(await apiFetch("/api/v1/consumables/movements"));
  }
  useEffect(() => {
    refresh().catch(() => undefined);
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const result = await apiFetch("/api/v1/consumables", {
        method: "POST",
        label: `Consumable ${name}`,
        body: JSON.stringify({ name, unit, onHand: Number(onHand) }),
      });
      setNotice(
        isQueued(result)
          ? `${name} saved on this phone; it syncs when online.`
          : `${name} added.`,
      );
    } catch (err) {
      setNotice("");
      setError(err instanceof Error ? err.message : "Could not add");
    }
    await refresh().catch(() => undefined);
  }

  return (
    <AppShell>
      <h1>Consumables</h1>
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
        <form onSubmit={onSubmit}>
          <label>
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
          <label>
            Unit
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value as ConsumableUnit)}
            >
              {CONSUMABLE_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
          <label>
            On hand
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={onHand}
              onChange={(e) => setOnHand(e.target.value)}
            />
          </label>
          <button type="submit">Add</button>
        </form>
      </div>
      <div className="card">
        <h2>Receive or use stock</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            try {
              const result = await apiFetch(
                "/api/v1/consumables/" + stockId + "/movements",
                {
                  method: "POST",
                  body: JSON.stringify({
                    direction,
                    quantity: Number(quantity),
                    reason,
                    occurredOn: new Date().toLocaleDateString("en-CA", {
                      timeZone: "Asia/Kolkata",
                    }),
                    clientOpId: crypto.randomUUID(),
                  }),
                },
              );
              setNotice(
                isQueued(result)
                  ? "Movement saved on this phone; waiting to sync."
                  : "Stock movement recorded.",
              );
              setReason("");
              await refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not record");
            }
          }}
        >
          <label>
            Item
            <select
              value={stockId}
              onChange={(e) => setStockId(e.target.value)}
              required
            >
              <option value="">Choose stock</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} — {Number(i.onHand)} {i.unit}
                </option>
              ))}
            </select>
          </label>
          <label>
            Movement
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
            >
              <option value="usage">Used</option>
              <option value="receipt">Received</option>
            </select>
          </label>
          <label>
            Quantity
            <input
              type="number"
              min="0.001"
              step="0.001"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              required
            />
          </label>
          <label>
            Reason
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
          </label>
          <button disabled={!stockId} type="submit">
            Record movement
          </button>
        </form>
      </div>
      <div className="card">
        <h2>Stock history</h2>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Item</th>
              <th>Movement</th>
              <th>Quantity</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {moves.map((m) => (
              <tr key={m.id}>
                <td>{m.occurredOn.slice(0, 10)}</td>
                <td>{m.consumable.name}</td>
                <td>{m.direction}</td>
                <td>
                  {Number(m.quantity)} {m.consumable.unit}
                </td>
                <td>{m.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {items.length === 0 ? (
        <EmptyState>
          No consumables recorded. Add abrasive, diamond, or other stock above.
        </EmptyState>
      ) : (
        <ul>
          {items.map((i) => (
            <li key={i.id}>
              {i.name} — {Number(i.onHand)} {i.unit}
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
