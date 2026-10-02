"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
export async function attachFile(
  file: File,
  entityType: string,
  entityId: string,
) {
  if (file.size > 4 * 1024 * 1024)
    throw new Error("Choose an image or PDF under 4 MB");
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  return apiFetch("/api/v1/files", {
    method: "POST",
    label: `Attachment ${file.name}`,
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type,
      base64,
      entityType,
      entityId,
    }),
  });
}
export function Attachments({
  type,
  id,
}: {
  type: "block" | "order";
  id: string;
}) {
  const [files, setFiles] = useState<Array<{ id: string; key: string }>>([]);
  const [error, setError] = useState("");
  const refresh = () =>
    apiFetch<Array<{ id: string; key: string }>>(
      `/api/v1/files?entityType=${type}&entityId=${encodeURIComponent(id)}`,
    ).then(setFiles);
  useEffect(() => {
    refresh().catch(() => undefined);
  }, [type, id]);
  return (
    <details>
      <summary>Attachments</summary>
      <label>
        Add bill or document
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              await attachFile(f, type, id);
              await refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Upload failed");
            }
          }}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {files.map((f) => (
        <button
          type="button"
          className="secondary"
          key={f.id}
          onClick={async () => {
            const data = await apiFetch<{
              base64: string;
              contentType: string;
            }>(`/api/v1/files/${f.id}`);
            const bytes = Uint8Array.from(atob(data.base64), (c) =>
              c.charCodeAt(0),
            );
            const url = URL.createObjectURL(
              new Blob([bytes], { type: data.contentType }),
            );
            const a = document.createElement("a");
            a.href = url;
            a.download =
              f.key.split("/").pop()?.replace(/^\d+-/, "") ?? "document";
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          {f.key.split("/").pop()?.replace(/^\d+-/, "")}
        </button>
      ))}
    </details>
  );
}
