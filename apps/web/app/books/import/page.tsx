"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { AppShell } from "../../../components/AppShell";
import { EmptyState } from "../../../components/EmptyState";
import { apiFetch } from "../../../lib/api";

type Preview = {
  kind: string;
  partyCount: number;
  arRupees: number;
  apRupees: number;
  netRupees: number;
  totalsOk: boolean;
  errors: string[];
  parties: Array<{ name: string; youllGet?: number; youllGive?: number; kind?: string }>;
};

function inr(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export default function KhataImportPage() {
  const [fileName, setFileName] = useState("customer-list.pdf");
  const [text, setText] = useState("");
  const [base64, setBase64] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  async function onFile(file: File) {
    setFileName(file.name);
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    bytes.forEach((b) => {
      binary += String.fromCharCode(b);
    });
    setBase64(btoa(binary));
    if (file.name.endsWith(".json") || file.name.endsWith(".csv") || file.type.includes("text")) {
      setText(new TextDecoder().decode(bytes));
    }
  }

  async function runPreview(event: FormEvent) {
    event.preventDefault();
    setError("");
    setResult("");
    try {
      const p = await apiFetch<Preview>("/api/v1/books/khata/preview", {
        method: "POST",
        body: JSON.stringify({ fileName, text: text || undefined, base64: base64 || undefined }),
      });
      setPreview(p);
      if (!p.totalsOk) setError(p.errors.join("; ") || "Totals do not match 12 Sep 2026 lock");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    }
  }

  async function confirm() {
    setError("");
    try {
      const batch = await apiFetch<{ partyCount: number; arMinor: number; apMinor: number }>(
        "/api/v1/books/khata/import",
        {
          method: "POST",
          body: JSON.stringify({ fileName, text: text || undefined, base64: base64 || undefined, confirm: true }),
        },
      );
      setResult(`Imported ${batch.partyCount} parties · AR ₹${(batch.arMinor / 100).toLocaleString("en-IN")}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    }
  }

  return (
    <AppShell>
      <p><Link href="/books">← Books</Link></p>
      <h1>Khata import</h1>
      <p>
        Live Khatabook customer-list PDF as of 12 Sep 2026. Must land 46 parties, You&apos;ll Get ₹1,25,61,248,
        You&apos;ll Give ₹1,63,671. Preview is required. Owner and manager only.
      </p>
      {error ? <p className="error">{error}</p> : null}
      {result ? <p>{result}</p> : null}
      <div className="card">
        <form onSubmit={runPreview}>
          <label>PDF / JSON / CSV<input type="file" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} /></label>
          <label>Or paste JSON/CSV<textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} /></label>
          <button type="submit">Preview</button>
        </form>
      </div>
      {!preview ? (
        <EmptyState>Upload the customer-list PDF and preview before confirming.</EmptyState>
      ) : (
        <div className="card">
          <p>{preview.partyCount} parties · Get {inr(preview.arRupees)} · Give {inr(preview.apRupees)} · net {inr(preview.netRupees)}</p>
          <button type="button" disabled={!preview.totalsOk} onClick={confirm}>
            Confirm opening books
          </button>
          <table>
            <thead><tr><th>Name</th><th>Get</th><th>Give</th></tr></thead>
            <tbody>
              {preview.parties.slice(0, 46).map((p) => (
                <tr key={p.name}><td>{p.name}</td><td>{inr(p.youllGet ?? 0)}</td><td>{inr(p.youllGive ?? 0)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
