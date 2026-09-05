"use client";

import { FormEvent, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { apiFetch } from "../../lib/api";

export default function TallyPage() {
  const [xml, setXml] = useState("<ENVELOPE></ENVELOPE>");
  const [fileName, setFileName] = useState("daybook.xml");
  const [result, setResult] = useState<string>("");

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const created = await apiFetch<{ id: string; summary: unknown }>("/api/v1/tally/daybook", {
      method: "POST",
      body: JSON.stringify({ fileName, xml }),
    });
    setResult(JSON.stringify(created.summary, null, 2));
  }

  return (
    <AppShell>
      <h1>Tally import</h1>
      <p>Historical reconciliation only. This does not move live inventory.</p>
      <div className="card">
        <form onSubmit={onSubmit}>
          <label>File name<input value={fileName} onChange={(e) => setFileName(e.target.value)} /></label>
          <label>XML<textarea value={xml} onChange={(e) => setXml(e.target.value)} rows={10} /></label>
          <button type="submit">Import daybook</button>
        </form>
      </div>
      {result ? <pre className="card">{result}</pre> : null}
    </AppShell>
  );
}
