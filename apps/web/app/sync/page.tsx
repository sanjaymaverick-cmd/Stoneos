"use client";

import { retryOutboxItem, type SyncResult } from "@stoneos/sync-client";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { flushQueuedWrites, outbox, pendingRef } from "../../lib/api";
import { describeProblem, useOutbox } from "../../lib/useOutbox";

/** The number a person will quote: an invoice number, a block serial, or nothing. */
function outcome(result: SyncResult): string | null {
  const body = (result.body ?? {}) as Record<string, any>;
  const dropped = Array.isArray(body.droppedSlabs) && body.droppedSlabs.length
    ? ` · sold first, left out: ${body.droppedSlabs.map((d: { slabSerial: string }) => d.slabSerial).join(", ")}`
    : "";
  const main =
    body.invoiceNumber ??
    body.creditNoteNumber ??
    body.block?.serialNumber ??
    (Array.isArray(body.slabs) ? `${body.slabs.length} slabs` : null);
  return main || dropped ? `${main ?? "Saved"}${dropped}` : null;
}

export default function SyncPage() {
  const { items, results, refresh } = useOutbox(2000);
  const stuck = items.filter((i) => i.conflict || i.dead);
  const waiting = items.filter((i) => !i.conflict && !i.dead);

  async function retry(id: string) {
    await retryOutboxItem(outbox, id);
    await flushQueuedWrites().catch(() => undefined);
    await refresh();
  }

  async function discard(id: string, label?: string) {
    if (!window.confirm(`Discard "${label ?? "this entry"}"? It will not reach the server.`)) return;
    await outbox.remove(id);
    await refresh();
  }

  return (
    <AppShell>
      <h1>Sync</h1>
      <p>
        Work saved on this phone while offline. It goes to the server by itself when the connection is back. Entries marked
        PEND get their real number then.
      </p>

      <div className="card">
        <h2>Needs you ({stuck.length})</h2>
        {stuck.length === 0 ? <EmptyState>Nothing is stuck.</EmptyState> : (
          <ul className="sync-list">
            {stuck.map((item) => (
              <li key={item.clientOpId}>
                <strong>{item.label ?? `${item.method} ${item.path}`}</strong> <span className="muted">{pendingRef(item.clientOpId)}</span>
                <p className="error">{describeProblem(item)}</p>
                <button type="button" onClick={() => retry(item.clientOpId)}>Try again</button>{" "}
                <button type="button" className="secondary" onClick={() => discard(item.clientOpId, item.label)}>Discard</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>Waiting to send ({waiting.length})</h2>
        {waiting.length === 0 ? <EmptyState>Everything on this phone has been sent.</EmptyState> : (
          <ul className="sync-list">
            {waiting.map((item) => (
              <li key={item.clientOpId}>
                {item.label ?? `${item.method} ${item.path}`} <span className="muted">{pendingRef(item.clientOpId)}</span>
                {item.dependsOn?.length ? <span className="muted"> · after an earlier step</span> : null}
                {describeProblem(item) ? <span className="muted"> · {describeProblem(item)}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>Recently synced</h2>
        {results.length === 0 ? <EmptyState>Nothing synced from this phone yet.</EmptyState> : (
          <ul className="sync-list">
            {results.filter((r) => r.label).slice(0, 50).map((result) => (
              <li key={result.clientOpId}>
                {result.label} <span className="muted">{pendingRef(result.clientOpId)} →</span>{" "}
                <strong>{outcome(result) ?? "Saved"}</strong>{" "}
                <span className="muted">{new Date(result.syncedAt).toLocaleString("en-IN")}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
