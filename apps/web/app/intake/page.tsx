"use client";

import { FormEvent, useEffect, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { apiFetch } from "../../lib/api";

type Draft = {
  id: string;
  kind: string;
  status: string;
  operationalDate: string;
  error?: string | null;
  mismatch?: unknown;
};

export default function IntakePage() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [kind, setKind] = useState<"rokad" | "dpr">("rokad");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [fileName, setFileName] = useState("rokad.csv");
  const [contentType, setContentType] = useState("text/csv");
  const [text, setText] = useState("date,particulars,in,out,mode,partyName\n");
  const [error, setError] = useState("");
  const [reason, setReason] = useState("rejected");

  async function refresh() {
    setDrafts(await apiFetch<Draft[]>("/api/v1/intake/drafts"));
  }
  useEffect(() => {
    refresh().catch(() => undefined);
  }, []);

  async function onPropose(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await apiFetch("/api/v1/intake/drafts", {
        method: "POST",
        body: JSON.stringify({
          kind,
          date,
          fileName,
          contentType,
          base64: btoa(unescape(encodeURIComponent(text))),
        }),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Propose failed");
    }
  }

  return (
    <AppShell>
      <h1>Supervisor intake</h1>
      <p>
        Propose rokad or DPR from the frozen CSV templates. A different person confirms. PDF/photo
        uploads stay unreadable until typed into CSV. DPR good-slab counts come from slab rows, never
        from the file. A bot may propose as supervisor; it must not confirm its own draft.
      </p>
      {error ? <p className="error">{error}</p> : null}
      <div className="card">
        <form onSubmit={onPropose}>
          <label>
            Kind
            <select value={kind} onChange={(e) => setKind(e.target.value as "rokad" | "dpr")}>
              <option value="rokad">rokad</option>
              <option value="dpr">dpr</option>
            </select>
          </label>
          <label>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label>File name<input value={fileName} onChange={(e) => setFileName(e.target.value)} /></label>
          <label>Content type<input value={contentType} onChange={(e) => setContentType(e.target.value)} /></label>
          <label>CSV<textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} /></label>
          <button type="submit">Propose draft</button>
        </form>
      </div>
      {drafts.length === 0 ? (
        <EmptyState>No intake drafts. Paste a rokad.csv or dpr.csv above.</EmptyState>
      ) : (
        drafts.map((d) => (
          <div className="card" key={d.id}>
            <h2>{d.kind} · {String(d.operationalDate).slice(0, 10)} · {d.status}</h2>
            {d.error ? <p className="error">{d.error}</p> : null}
            {d.status === "proposed" ? (
              <>
                <button type="button" onClick={() => apiFetch(`/api/v1/intake/drafts/${d.id}/confirm`, { method: "POST" }).then(refresh).catch((err) => setError(err instanceof Error ? err.message : "Confirm failed"))}>
                  Confirm
                </button>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    apiFetch(`/api/v1/intake/drafts/${d.id}/reject`, { method: "POST", body: JSON.stringify({ reason }) })
                      .then(refresh)
                      .catch((err) => setError(err instanceof Error ? err.message : "Reject failed"));
                  }}
                >
                  <label>Reject reason<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
                  <button type="submit" className="secondary">Reject</button>
                </form>
              </>
            ) : null}
          </div>
        ))
      )}
    </AppShell>
  );
}
