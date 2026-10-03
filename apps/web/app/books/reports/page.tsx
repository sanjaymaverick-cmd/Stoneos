"use client";

/*
 * The reports people actually ask for.
 *
 * Shaped after the khata statements this replaces: an opening balance, one line per
 * entry with the running balance beside it, a grand total, and Dr/Cr on every figure.
 * Two jobs live here and they are deliberately separate — reading one party's
 * account, and seeing every unpaid balance at once.
 */

import { FormEvent, useCallback, useEffect, useState } from "react";
import { AppShell } from "../../../components/AppShell";
import { EmptyState } from "../../../components/EmptyState";
import { apiFetch, downloadFile } from "../../../lib/api";
import { formatInr, todayIst } from "../../../lib/format";

type Party = { id: string; name: string; kind: string };

type StatementRow = {
  date: string;
  details: string;
  mode: string;
  debit: number;
  credit: number;
  balance: number;
};

type Statement = {
  party: { id: string; name: string; kind: string };
  from: string | null;
  to: string | null;
  rows: StatementRow[];
  openingBalance: number;
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
};

type DueRow = { id: string; name: string; kind: string; due: number };
type Dues = {
  receivable: DueRow[];
  payable: DueRow[];
  totalReceivable: number;
  totalPayable: number;
  settledParties: number;
};

/** A balance says nothing without its direction. */
function drCr(balance: number) {
  if (Math.round(balance * 100) === 0) return { label: "Settled", amount: 0 };
  return { label: balance > 0 ? "Dr" : "Cr", amount: Math.abs(balance) };
}

const firstOfThisYear = () => `${new Date().getFullYear()}-01-01`;

export default function ReportsPage() {
  const [parties, setParties] = useState<Party[]>([]);
  const [partyId, setPartyId] = useState("");
  const [from, setFrom] = useState(firstOfThisYear());
  const [to, setTo] = useState(todayIst());
  const [statement, setStatement] = useState<Statement | null>(null);
  const [dues, setDues] = useState<Dues | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const [people, owed] = await Promise.all([
      apiFetch<Party[]>("/api/v1/books/parties"),
      apiFetch<Dues>("/api/v1/books/dues"),
    ]);
    setParties(people);
    setDues(owed);
  }, []);

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, [load]);

  const range = () => `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

  async function showStatement(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy("statement");
    try {
      setStatement(
        await apiFetch<Statement>(`/api/v1/books/parties/${partyId}${range()}`),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function download(path: string, name: string, tag: string) {
    setError("");
    setBusy(tag);
    try {
      await downloadFile(path, name);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  const closing = statement ? drCr(statement.closingBalance) : null;
  const opening = statement ? drCr(statement.openingBalance) : null;

  return (
    <AppShell>
      <div className="page">
        <div className="dash-head">
          <h1>Reports</h1>
          <p className="muted">
            One party&apos;s account, or everyone who owes money. Dr means they owe
            us; Cr means we owe them.
          </p>
        </div>

        {error ? <p className="error">{error}</p> : null}

        <div className="card">
          <h2>Customer or supplier statement</h2>
          <p className="muted">
            Every sale, purchase and payment against one name, with how each one was
            settled and the balance after it.
          </p>
          <form onSubmit={showStatement}>
            <label>
              Who
              <select value={partyId} onChange={(e) => setPartyId(e.target.value)}>
                <option value="">Choose a name</option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.kind}
                  </option>
                ))}
              </select>
            </label>
            <label>
              From
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label>
              To
              <input type="date" max={todayIst()} value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <button type="submit" disabled={!partyId || busy === "statement"}>
              {busy === "statement" ? "Reading…" : "Show statement"}
            </button>{" "}
            <button
              type="button"
              className="secondary"
              disabled={!partyId || busy === "one"}
              onClick={() =>
                void download(
                  `/api/v1/books/parties/${partyId}/statement.xlsx${range()}`,
                  "statement.xlsx",
                  "one",
                )
              }
            >
              Download this one
            </button>{" "}
            <button
              type="button"
              className="secondary"
              disabled={busy === "all"}
              onClick={() =>
                void download(
                  `/api/v1/books/statements.xlsx${range()}`,
                  "customer-statements.xlsx",
                  "all",
                )
              }
            >
              Download everyone
            </button>
          </form>
        </div>

        {statement && opening && closing ? (
          <div className="card wide">
            <h2>{statement.party.name}</h2>
            <p className="muted">
              {statement.from ?? "the beginning"} to {statement.to ?? "today"} ·{" "}
              {statement.rows.length} entries
            </p>
            <div className="grid">
              <div className="metric">
                <span>Opening</span>
                <b>
                  {formatInr(opening.amount)} {opening.label}
                </b>
              </div>
              <div className="metric">
                <span>Debit (-)</span>
                <b>{formatInr(statement.totalDebit)}</b>
              </div>
              <div className="metric">
                <span>Credit (+)</span>
                <b>{formatInr(statement.totalCredit)}</b>
              </div>
              <div className="metric">
                <span>Closing</span>
                <b>
                  {formatInr(closing.amount)} {closing.label}
                </b>
              </div>
            </div>
            {statement.rows.length === 0 ? (
              <EmptyState>Nothing in this period.</EmptyState>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Details</th>
                    <th>Paid by</th>
                    <th className="num">Debit (-)</th>
                    <th className="num">Credit (+)</th>
                    <th className="num">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.rows.map((row, i) => {
                    const at = drCr(row.balance);
                    return (
                      <tr key={`${row.date}-${i}`}>
                        <td>{row.date}</td>
                        <td>{row.details}</td>
                        <td className="muted">{row.mode || "—"}</td>
                        <td className="num">{row.debit ? formatInr(row.debit) : ""}</td>
                        <td className="num">{row.credit ? formatInr(row.credit) : ""}</td>
                        <td className="num">
                          {formatInr(at.amount)} <span className="muted">{at.label}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        ) : null}

        <div className="card wide">
          <h2>Who owes what</h2>
          <p className="muted">
            Everyone with a balance still open. Chasing money and scheduling payments
            are different jobs, so they are different lists.
          </p>
          <p>
            <button
              type="button"
              disabled={busy === "dues"}
              onClick={() => void download("/api/v1/books/dues.xlsx", "dues.xlsx", "dues")}
            >
              {busy === "dues" ? "Preparing…" : "Download both lists"}
            </button>
          </p>
          {dues ? (
            <>
              <div className="grid">
                <div className="metric">
                  <span>To collect</span>
                  <b>{formatInr(dues.totalReceivable)}</b>
                </div>
                <div className="metric">
                  <span>To pay</span>
                  <b>{formatInr(dues.totalPayable)}</b>
                </div>
                <div className="metric">
                  <span>Settled</span>
                  <b>{dues.settledParties}</b>
                </div>
              </div>

              <h3>Money owed to us</h3>
              {dues.receivable.length === 0 ? (
                <EmptyState>Nobody owes anything.</EmptyState>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Party</th>
                      <th>Kind</th>
                      <th className="num">Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dues.receivable.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <strong>{r.name}</strong>
                        </td>
                        <td className="muted">{r.kind}</td>
                        <td className="num">{formatInr(r.due)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <h3>Money we owe</h3>
              {dues.payable.length === 0 ? (
                <EmptyState>Nothing outstanding.</EmptyState>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Party</th>
                      <th>Kind</th>
                      <th className="num">Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dues.payable.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <strong>{r.name}</strong>
                        </td>
                        <td className="muted">{r.kind}</td>
                        <td className="num">{formatInr(r.due)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
