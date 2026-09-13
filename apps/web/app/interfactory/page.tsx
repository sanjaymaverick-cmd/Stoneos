"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { apiFetch } from "../../lib/api";

type Sister = { id: string; name: string; location: string | null; operatingStatus: string };
type Position = {
  sisterFactoryId: string;
  sisterName: string;
  arOutstanding: number;
  apOutstanding: number;
  net: number;
};
type Payable = {
  id: string;
  amount: string;
  creditedAmount: string;
  sellerFactory: { name: string };
  settlements: Array<{ amount: string }>;
};

function inr(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export default function InterfactoryPage() {
  const [sisters, setSisters] = useState<Sister[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [payables, setPayables] = useState<Payable[]>([]);
  const [sisterId, setSisterId] = useState("");
  const [newName, setNewName] = useState("");
  const [ownerUsername, setOwnerUsername] = useState("");
  const [created, setCreated] = useState<{ ownerUsername: string; password: string; factory: { name: string } } | null>(null);
  const [error, setError] = useState("");
  const opIds = useRef<Record<string, string>>({});
  function stableOp(key: string) {
    opIds.current[key] ??= crypto.randomUUID();
    return opIds.current[key];
  }

  async function refresh() {
    const [f, p, b] = await Promise.all([
      apiFetch<Sister[]>("/api/v1/interfactory/factories"),
      apiFetch<Position[]>("/api/v1/interfactory/positions"),
      apiFetch<Payable[]>("/api/v1/interfactory/payables"),
    ]);
    setSisters(f);
    setPositions(p);
    setPayables(b);
    if (!sisterId && f[0]) setSisterId(f[0].id);
  }
  useEffect(() => { refresh().catch((e) => setError(e instanceof Error ? e.message : "Load failed")); }, []);

  async function createFactory(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const row = await apiFetch<{ ownerUsername: string; password: string; factory: { name: string } }>(
        "/api/v1/interfactory/factories",
        { method: "POST", body: JSON.stringify({ name: newName, ownerUsername }) },
      );
      setCreated(row);
      setNewName("");
      setOwnerUsername("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create factory");
    }
  }

  async function link(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await apiFetch("/api/v1/interfactory/links", {
        method: "POST",
        body: JSON.stringify({ sisterFactoryId: sisterId }),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not link");
    }
  }

  async function settle(payable: Payable) {
    const settled = payable.settlements.reduce((s, r) => s + Number(r.amount), 0);
    const due = Number(payable.amount) - Number(payable.creditedAmount) - settled;
    if (due <= 0) return;
    setError("");
    try {
      await apiFetch(`/api/v1/interfactory/payables/${payable.id}/pay`, {
        method: "POST",
        body: JSON.stringify({
          amount: due,
          method: "neft",
          paidAt: new Date().toISOString().slice(0, 10),
          clientOpId: stableOp(`ifpay:${payable.id}`),
        }),
      });
      delete opIds.current[`ifpay:${payable.id}`];
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Settlement failed");
    }
  }

  return (
    <AppShell>
      <h1>Sister plants</h1>
      <p>
        Link the other yards on this server. Sales to a sister customer post AP and a stock receipt on their
        factoryId. Settlement pays seller AR and buyer AP in one locked write. Tally XML stays archive-only.
      </p>
      {error ? <p className="error">{error}</p> : null}
      {created ? (
        <p>Created {created.factory.name}. Owner <code>{created.ownerUsername}</code> one-time password <code>{created.password}</code></p>
      ) : null}
      <div className="card">
        <h2>Register a factory</h2>
        <form onSubmit={createFactory}>
          <label>Factory name<input value={newName} onChange={(e) => setNewName(e.target.value)} required /></label>
          <label>Owner username<input value={ownerUsername} onChange={(e) => setOwnerUsername(e.target.value)} required minLength={3} /></label>
          <button type="submit">Create factory</button>
        </form>
      </div>
      <div className="card">
        <h2>Link for trade</h2>
        {sisters.length === 0 ? <EmptyState>No other factories on this server yet.</EmptyState> : (
          <form onSubmit={link}>
            <label>Sister
              <select value={sisterId} onChange={(e) => setSisterId(e.target.value)}>
                {sisters.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <button type="submit">Link both ways</button>
          </form>
        )}
      </div>
      <div className="card">
        <h2>Net position</h2>
        {positions.length === 0 ? <EmptyState>Link a sister plant to see AR, AP, and net.</EmptyState> : (
          <table>
            <thead><tr><th>Plant</th><th>They owe us</th><th>We owe them</th><th>Net</th></tr></thead>
            <tbody>
              {positions.map((p) => (
                <tr key={p.sisterFactoryId}>
                  <td>{p.sisterName}</td>
                  <td>{inr(p.arOutstanding)}</td>
                  <td>{inr(p.apOutstanding)}</td>
                  <td>{inr(p.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="card">
        <h2>Payables (we buy)</h2>
        {payables.length === 0 ? <EmptyState>No interfactory bills yet.</EmptyState> : payables.map((p) => {
          const due = Number(p.amount) - Number(p.creditedAmount) - p.settlements.reduce((s, r) => s + Number(r.amount), 0);
          return (
            <p key={p.id}>
              {p.sellerFactory.name} — {inr(Number(p.amount))} due {inr(due)}
              {due > 0 ? <button type="button" onClick={() => settle(p)}>Settle</button> : " · settled"}
            </p>
          );
        })}
      </div>
    </AppShell>
  );
}
