"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "../../../../components/AppShell";
import { EmptyState } from "../../../../components/EmptyState";
import { apiFetch } from "../../../../lib/api";

type Row = { date: string; details: string; debit: number; credit: number; balance: number; source: string };
type Statement = { party: { id: string; name: string; kind: string }; rows: Row[]; youllGet: number; youllGive: number };

function inr(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export default function PartyStatementPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Statement | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!params.id) return;
    apiFetch<Statement>(`/api/v1/books/parties/${params.id}`)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load statement"));
  }, [params.id]);

  return (
    <AppShell>
      <p><Link href="/books">← Parties</Link></p>
      <h1>{data?.party.name ?? "Party statement"}</h1>
      <p>
        {data?.party.kind ?? ""} · You&apos;ll Get {inr(data?.youllGet ?? 0)} · You&apos;ll Give {inr(data?.youllGive ?? 0)}
      </p>
      {error ? <p className="error">{error}</p> : null}
      {!data || data.rows.length === 0 ? (
        <EmptyState>No voucher lines for this party yet.</EmptyState>
      ) : (
        <table>
          <thead>
            <tr><th>Date</th><th>Details</th><th>Debit</th><th>Credit</th><th>Balance</th></tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={`${r.date}-${i}`}>
                <td>{r.date}</td>
                <td>{r.details}<span className="hint"> · {r.source}</span></td>
                <td>{r.debit ? inr(r.debit) : ""}</td>
                <td>{r.credit ? inr(r.credit) : ""}</td>
                <td>{inr(r.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </AppShell>
  );
}
