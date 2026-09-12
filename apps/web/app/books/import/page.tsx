"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { AppShell } from "../../../components/AppShell";
import { apiFetch } from "../../../lib/api";

export default function KhataImportPage() {
  const [fileName, setFileName] = useState("customer-list.json");
  const [text, setText] = useState("");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setResult("");
    try {
      const batch = await apiFetch<{ partyCount: number; arMinor: number; apMinor: number }>(
        "/api/v1/books/khata/import",
        { method: "POST", body: JSON.stringify({ fileName, text }) },
      );
      setResult(
        `Imported ${batch.partyCount} parties · AR ₹${(batch.arMinor / 100).toLocaleString("en-IN")} · AP ₹${(batch.apMinor / 100).toLocaleString("en-IN")}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    }
  }

  return (
    <AppShell>
      <p><Link href="/books">← Books</Link></p>
      <h1>Khata import</h1>
      <p>
        One-time customer-list migrate as of 12 Sep 2026. Must land 46 parties, You&apos;ll Get ₹1,25,61,248,
        You&apos;ll Give ₹1,63,671. Do not mint INV numbers from debit narration. Do not post payments from
        “Cash 97070” lines. Owner and manager only.
      </p>
      {error ? <p className="error">{error}</p> : null}
      {result ? <p>{result}</p> : null}
      <div className="card">
        <form onSubmit={onSubmit}>
          <label>File name<input value={fileName} onChange={(e) => setFileName(e.target.value)} /></label>
          <label>JSON or CSV<textarea value={text} onChange={(e) => setText(e.target.value)} rows={14} required /></label>
          <button type="submit">Import opening books</button>
        </form>
      </div>
    </AppShell>
  );
}
