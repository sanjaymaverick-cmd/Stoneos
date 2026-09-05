"use client";

import { FormEvent, useEffect, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { apiFetch } from "../../lib/api";

export default function FilesPage() {
  const [files, setFiles] = useState<Array<{ id: string; key: string; contentType: string }>>([]);
  const [fileName, setFileName] = useState("note.txt");
  const [content, setContent] = useState("factory note");

  async function refresh() {
    setFiles(await apiFetch("/api/v1/files"));
  }
  useEffect(() => { refresh().catch(() => undefined); }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await apiFetch("/api/v1/files", {
      method: "POST",
      body: JSON.stringify({
        fileName,
        contentType: "text/plain",
        base64: btoa(content),
      }),
    });
    await refresh();
  }

  return (
    <AppShell>
      <h1>Documents</h1>
      <div className="card">
        <form onSubmit={onSubmit}>
          <label>File name<input value={fileName} onChange={(e) => setFileName(e.target.value)} /></label>
          <label>Text<textarea value={content} onChange={(e) => setContent(e.target.value)} /></label>
          <button type="submit">Upload</button>
        </form>
      </div>
      <ul>{files.map((f) => <li key={f.id}>{f.key} ({f.contentType})</li>)}</ul>
    </AppShell>
  );
}
