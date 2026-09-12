"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { apiFetch } from "../../lib/api";
import type { PublicUser } from "@stoneos/contracts";
import { HISTORICAL_IMPORT_ROLES, canAccess } from "@stoneos/contracts";

type Party = {
  id: string;
  name: string;
  kind: string;
  youllGet: number;
  youllGive: number;
};

type Outstanding = { youllGet: number; youllGive: number; net: number; parties: Party[] };

function inr(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export default function BooksPage() {
  const [data, setData] = useState<Outstanding | null>(null);
  const [me, setMe] = useState<PublicUser | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch<PublicUser>("/api/v1/auth/me").then(setMe).catch(() => undefined);
    apiFetch<Outstanding>("/api/v1/books/outstanding")
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load books"));
  }, []);

  const canImport = me ? canAccess(me.role, HISTORICAL_IMPORT_ROLES) : false;
  const parties = data?.parties ?? [];

  return (
    <AppShell>
      <h1>Books</h1>
      <p>
        Party statements replace Khatabook. Opening balances are as of 12 Sep 2026. New sales and
        collections after cutover live only in StoneOS. File GSTR outside; Tally XML is archive-only.
      </p>
      {error ? <p className="error">{error}</p> : null}
      <div className="grid">
        <div className="metric"><span className="hint">You&apos;ll Get</span><b>{inr(data?.youllGet ?? 0)}</b></div>
        <div className="metric"><span className="hint">You&apos;ll Give</span><b>{inr(data?.youllGive ?? 0)}</b></div>
        <div className="metric"><span className="hint">Net</span><b>{inr(data?.net ?? 0)}</b></div>
      </div>
      <p>
        <Link href="/books/rokad">Rokad / cash drawer</Link>
        {canImport ? <> · <Link href="/books/import">Khata import</Link> · <Link href="/tally">Tally archive</Link></> : null}
      </p>
      {parties.length === 0 ? (
        <EmptyState>No parties yet. Owner or manager imports the Khatabook customer list to seed opening AR/AP.</EmptyState>
      ) : (
        <table>
          <thead>
            <tr><th>Party</th><th>Kind</th><th>You&apos;ll Get</th><th>You&apos;ll Give</th></tr>
          </thead>
          <tbody>
            {parties.map((p) => (
              <tr key={p.id}>
                <td><Link href={`/books/parties/${p.id}`}>{p.name}</Link></td>
                <td>{p.kind}</td>
                <td>{inr(p.youllGet)}</td>
                <td>{inr(p.youllGive)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </AppShell>
  );
}
