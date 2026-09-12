"use client";

import { FormEvent, useEffect, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { apiFetch } from "../../lib/api";

type Summary = {
  vouchers?: number;
  ledgers?: string[];
  byType?: Record<string, number>;
  totalAbsAmount?: number;
  entries?: Array<{ type: string; number: string; date: string; party: string; amount: number }>;
  writesInventory?: boolean;
};
type Batch = { id: string; fileName: string; createdAt: string; summary: Summary };

export default function TallyPage() {
  const [xml, setXml] = useState(`<ENVELOPE>
<VOUCHER>
<DATE>20260912</DATE>
<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
<VOUCHERNUMBER>1</VOUCHERNUMBER>
<PARTYLEDGERNAME>Sister plant</PARTYLEDGERNAME>
<LEDGERNAME>Sister plant</LEDGERNAME><AMOUNT>-1000.00</AMOUNT>
<LEDGERNAME>Sales</LEDGERNAME><AMOUNT>1000.00</AMOUNT>
</VOUCHER>
</ENVELOPE>`);
  const [fileName, setFileName] = useState("daybook.xml");
  const [batches, setBatches] = useState<Batch[]>([]);
  const [error, setError] = useState("");

  async function refresh() {
    setBatches(await apiFetch<Batch[]>("/api/v1/tally/batches"));
  }
  useEffect(() => { refresh().catch(() => undefined); }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await apiFetch("/api/v1/tally/daybook", {
        method: "POST",
        body: JSON.stringify({ fileName, xml }),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    }
  }

  return (
    <AppShell>
      <h1>Tally archive</h1>
      <p>
        XML daybook import is archive-only (owner/manager). Live party balances live under Books.
        This log does not move inventory, invoices, or yard stock.
      </p>
      {error ? <p className="error">{error}</p> : null}
      <div className="card">
        <form onSubmit={onSubmit}>
          <label>File name<input value={fileName} onChange={(e) => setFileName(e.target.value)} /></label>
          <label>XML<textarea value={xml} onChange={(e) => setXml(e.target.value)} rows={10} /></label>
          <button type="submit">Import daybook</button>
        </form>
      </div>
      {batches.length === 0 ? (
        <EmptyState>No daybooks imported yet. Paste a Tally XML export above.</EmptyState>
      ) : batches.map((b) => {
        const s = b.summary ?? {};
        return (
          <div className="card" key={b.id}>
            <h2>{b.fileName}</h2>
            <p>
              {s.vouchers ?? 0} vouchers · {inr(s.totalAbsAmount ?? 0)} · ledgers {(s.ledgers ?? []).join(", ") || "none"}
              {s.writesInventory === false ? " · does not write stock" : ""}
            </p>
            {(s.entries ?? []).length === 0 ? null : (
              <table>
                <thead><tr><th>Date</th><th>Type</th><th>No</th><th>Party</th><th>Amount</th></tr></thead>
                <tbody>
                  {(s.entries ?? []).slice(0, 50).map((e, i) => (
                    <tr key={`${b.id}-${i}`}>
                      <td>{e.date}</td>
                      <td>{e.type}</td>
                      <td>{e.number}</td>
                      <td>{e.party}</td>
                      <td>{inr(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </AppShell>
  );
}

function inr(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}
