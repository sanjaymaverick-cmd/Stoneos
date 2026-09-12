"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { AppShell } from "../../../components/AppShell";
import { EmptyState } from "../../../components/EmptyState";
import { apiFetch } from "../../../lib/api";
import type { PublicUser } from "@stoneos/contracts";
import { CASH_DRAWER_LOCK_ROLES, canAccess } from "@stoneos/contracts";

type CashRow = { voucherId: string; memo?: string | null; in: number; out: number; party?: string };
type Rokad = {
  date: string;
  drawer: { status: string; countedClose?: number | null } | null;
  cash: CashRow[];
};

function inr(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export default function RokadPage() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<Rokad | null>(null);
  const [counted, setCounted] = useState("");
  const [me, setMe] = useState<PublicUser | null>(null);
  const [error, setError] = useState("");

  async function refresh(d = date) {
    setError("");
    setData(await apiFetch<Rokad>(`/api/v1/books/rokad?date=${d}`));
  }

  useEffect(() => {
    apiFetch<PublicUser>("/api/v1/auth/me").then(setMe).catch(() => undefined);
    refresh().catch((err) => setError(err instanceof Error ? err.message : "Failed to load rokad"));
  }, []);

  async function onLock(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await apiFetch("/api/v1/books/rokad/lock", {
        method: "POST",
        body: JSON.stringify({ date, countedClose: Number(counted) }),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lock failed");
    }
  }

  const canLock = me ? canAccess(me.role, CASH_DRAWER_LOCK_ROLES) : false;
  const cash = data?.cash ?? [];

  return (
    <AppShell>
      <p><Link href="/books">← Books</Link></p>
      <h1>Rokad</h1>
      <p>Cash in and out for the operational day. Locking the drawer blocks further cash vouchers that day.</p>
      {error ? <p className="error">{error}</p> : null}
      <div className="card">
        <label>
          Date
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              refresh(e.target.value).catch((err) => setError(err instanceof Error ? err.message : "Failed"));
            }}
          />
        </label>
        <p>Drawer: {data?.drawer?.status ?? "open"}</p>
        {canLock ? (
          <form onSubmit={onLock}>
            <label>Counted close<input value={counted} onChange={(e) => setCounted(e.target.value)} required /></label>
            <button type="submit">Lock drawer</button>
          </form>
        ) : (
          <p className="empty">Only owner, manager, or accountant can lock the drawer.</p>
        )}
      </div>
      {cash.length === 0 ? (
        <EmptyState>No cash vouchers on this day.</EmptyState>
      ) : (
        <table>
          <thead>
            <tr><th>Memo</th><th>Party</th><th>In</th><th>Out</th></tr>
          </thead>
          <tbody>
            {cash.map((r) => (
              <tr key={r.voucherId}>
                <td>{r.memo}</td>
                <td>{r.party}</td>
                <td>{r.in ? inr(r.in) : ""}</td>
                <td>{r.out ? inr(r.out) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </AppShell>
  );
}
