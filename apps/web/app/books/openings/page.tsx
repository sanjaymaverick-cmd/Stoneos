"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { AppShell } from "../../../components/AppShell";
import { apiFetch } from "../../../lib/api";
import { formatInr, todayIst } from "../../../lib/format";

const categories = {
  RAW_BLOCK: "Raw block", UNPOLISHED_LOT: "Unpolished lot", FINISHED_LOT: "Finished lot",
  CONSUMABLE: "Consumable", DEBTOR: "Customer owes us", CREDITOR: "We owe supplier", CASH: "Cash balance", BANK: "Bank balance",
};
type Kind = keyof typeof categories;
type Row = { ref: string; kind: Kind; name: string; amount: number; note?: string; sourceReference?: string; serial?: string; weightTons?: number; quantity?: number; sqftPerSlab?: number; unit?: string; pendingCash?: number; pendingBank?: number; processingStage?: string; workLocation?: string };
type Receipt = { id: string; amount: string; method: string; paidAt: string; note?: string; receivedBy?: string; reference?: string };
type Line = { id: string; ref: string; kind: Kind; payload: Row; amount: string; settledAmount: string; settlements: Receipt[] };
type Batch = { id: string; title: string; effectiveDate: string; note?: string; status: string; version: number; enteredByIds: string[]; lines: Line[] };
type User = { id: string; role: string };

export default function OpeningBalancesPage() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [current, setCurrent] = useState<Batch | null>(null);
  const [me, setMe] = useState<User | null>(null);
  const [title, setTitle] = useState("Opening balances");
  const [date, setDate] = useState(todayIst());
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [row, setRow] = useState<Row>({ ref: "", kind: "DEBTOR", name: "", amount: 0 });
  const [editingRef, setEditingRef] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [reconciled, setReconciled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const createKey = useRef<string | null>(null);
  const canWrite = me?.role === "owner" || me?.role === "manager";
  const draft = current?.status === "DRAFT";
  function select(batch: Batch | null) {
    setCurrent(batch); setRows(batch?.lines.map(l => l.payload) ?? []);
    setTitle(batch?.title ?? "Opening balances"); setDate(batch?.effectiveDate.slice(0, 10) ?? todayIst()); setNote(batch?.note ?? "");
    setDirty(false); setReconciled(false); setEditingRef(null); setRow({ ref: "", kind: "DEBTOR", name: "", amount: 0 });
  }
  async function refresh(id?: string) {
    const list = await apiFetch<Batch[]>("/api/v1/books/openings"); setBatches(list);
    if (id) select(list.find(b => b.id === id) ?? null);
  }
  useEffect(() => {
    apiFetch<User>("/api/v1/auth/me").then(setMe).catch(e => setError(e.message));
    refresh().catch(e => setError(e.message));
  }, []);
  async function write(path: string, body: unknown, method = "POST") {
    setBusy(true); setError(""); setNotice("");
    try {
      const batch = await apiFetch<Batch>(path, { method, onlineOnly: true, body: JSON.stringify(body) });
      await refresh(batch.id); setNotice("Saved and read back from StoneOS.");
      return true;
    } catch (e) { setError((e as Error).message); return false; }
    finally { setBusy(false); }
  }
  async function save() {
    const body = { title, effectiveDate: date, note, lines: rows };
    if (current) await write(`/api/v1/books/openings/${current.id}`, { ...body, baseVersion: current.version }, "PATCH");
    else {
      createKey.current ??= crypto.randomUUID();
      if (await write("/api/v1/books/openings", { ...body, clientOpId: createKey.current })) createKey.current = null;
    }
  }
  function addRow(event: FormEvent) {
    event.preventDefault();
    const next = { ...row, ref: editingRef ?? crypto.randomUUID() };
    setRows(old => editingRef ? old.map(r => r.ref === editingRef ? next : r) : [...old, next]);
    setRow({ ref: "", kind: row.kind, name: "", amount: 0 }); setEditingRef(null); setDirty(true);
  }
  const stock = ["RAW_BLOCK", "UNPOLISHED_LOT", "FINISHED_LOT"].includes(row.kind);
  const lot = row.kind === "UNPOLISHED_LOT" || row.kind === "FINISHED_LOT";
  const editable = canWrite && (!current || draft);
  return <AppShell>
    <h1>Opening balances</h1>
    <p><Link href="/books">Books</Link> · <Link href="/sales/reports">Party reports</Link></p>
    <p>Start from your verified closing stock and dues. Historical invoices are not required. Use the first day of the new period as the effective date—for example, 1 October for balances at the close of 30 September.</p>
    <p>The effective date is the physical count date, even when entered later. A 1 October opening must include stock at its 1 October stage; record subsequent cutting, processing, purchases and dispatches separately. A 9 October count cannot be labelled 1 October without reconstructing those movements.</p>
    <p className="hint">Opening entries add missing stock and balances. They do not replace existing records. Reconcile everything already in StoneOS before approval. One general opening batch can be approved per factory.</p>
    {error && <p className="error" role="alert">{error}</p>}{notice && <p className="hint" role="status">{notice}</p>}
    <div className="card">
      <label>Opening batch<select value={current?.id ?? ""} disabled={busy || dirty} onChange={e => select(batches.find(b => b.id === e.target.value) ?? null)}><option value="">New draft</option>{batches.map(b => <option key={b.id} value={b.id}>{b.title} · {b.effectiveDate.slice(0, 10)} · {b.status}</option>)}</select></label>
      {current && <p>Status: <strong>{current.status}</strong></p>}
      <label>Batch title<input value={title} disabled={!editable || busy} maxLength={200} onChange={e => { setTitle(e.target.value); setDirty(true); }} /></label>
      <label>Effective opening date<input type="date" value={date} max={todayIst()} disabled={!editable || busy} onChange={e => { setDate(e.target.value); setDirty(true); }} /></label>
      <label>Batch note<textarea value={note} maxLength={2000} disabled={!editable || busy} onChange={e => { setNote(e.target.value); setDirty(true); }} /></label>
    </div>
    {editable && <div className="card"><h2>{editingRef ? "Edit opening line" : "Add opening line"}</h2><form onSubmit={addRow}>
      <label>Category<select value={row.kind} onChange={e => setRow({ ref: "", kind: e.target.value as Kind, name: "", amount: 0 })}>{Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>Name / variety<input required maxLength={200} value={row.name} onChange={e => setRow({ ...row, name: e.target.value })} /></label>
      {stock && <label>Block / lot reference<input required maxLength={200} value={row.serial ?? ""} onChange={e => setRow({ ...row, serial: e.target.value })} /></label>}
      {row.kind === "RAW_BLOCK" && <label>Block weight (tons)<input required type="number" min="0.001" max="60" step="0.001" value={row.weightTons ?? ""} onChange={e => setRow({ ...row, weightTons: Number(e.target.value) })} /></label>}
      {(lot || row.kind === "CONSUMABLE") && <label>{lot ? "Slab count" : "Quantity"}<input required type="number" min={lot ? "1" : "0.001"} max="1000000" step={lot ? "1" : "0.001"} value={row.quantity ?? ""} onChange={e => setRow({ ...row, quantity: Number(e.target.value) })} /></label>}
      {lot && <label>Sqft per slab<input required type="number" min="0.01" max="999999.99" step="0.01" value={row.sqftPerSlab ?? ""} onChange={e => setRow({ ...row, sqftPerSlab: Number(e.target.value) })} /></label>}
      {row.kind === "UNPOLISHED_LOT" && <><label>Stage at opening date<select value={row.processingStage ?? "rough"} onChange={e => setRow({ ...row, processingStage: e.target.value })}><option value="rough">Rough slabs on ground</option><option value="grinding">Under grinding</option><option value="resin">Under resin treatment</option><option value="polishing">Under polishing</option></select></label><label>Machine / work location<input maxLength={200} value={row.workLocation ?? ""} onChange={e => setRow({ ...row, workLocation: e.target.value })} placeholder="LPM machine or yard location" /></label><p>These slabs remain unfinished and unavailable as polished stock until completion is recorded. This records the opening stage; it does not start a machine session.</p></>}
      {row.kind === "CONSUMABLE" && <label>Unit<select required value={row.unit ?? ""} onChange={e => setRow({ ...row, unit: e.target.value })}><option value="">Choose unit</option><option value="piece">Piece</option><option value="litre">Litre</option></select></label>}
      <label>{row.kind === "DEBTOR" ? "Customer owes (₹)" : row.kind === "CREDITOR" ? "We owe supplier (₹)" : "Opening value (₹)"}<input required type="number" min="0" max="20000000" step="0.01" value={row.amount} onChange={e => setRow({ ...row, amount: Number(e.target.value) })} /></label>
      {row.kind === "DEBTOR" && <fieldset><legend>Optional expected collection split</legend><label>Cash pending (₹)<input type="number" min="0" step="0.01" value={row.pendingCash ?? 0} onChange={e => setRow({ ...row, pendingCash: Number(e.target.value) })} /></label><label>Bank / UPI pending (₹)<input type="number" min="0" step="0.01" value={row.pendingBank ?? 0} onChange={e => setRow({ ...row, pendingBank: Number(e.target.value) })} /></label><p>The split explains the same due; it does not add another balance. You can clarify it later using customer Edit on Sales.</p></fieldset>}
      <label>Source reference<input maxLength={2000} value={row.sourceReference ?? ""} onChange={e => setRow({ ...row, sourceReference: e.target.value })} placeholder="Closing sheet, message or count reference" /></label>
      <label>Line note<textarea maxLength={2000} value={row.note ?? ""} onChange={e => setRow({ ...row, note: e.target.value })} /></label>
      <button type="submit" disabled={busy}>{editingRef ? "Update line" : "Add line"}</button>
      {editingRef && <button type="button" className="secondary" onClick={() => { setEditingRef(null); setRow({ ref: "", kind: "DEBTOR", name: "", amount: 0 }); }}>Cancel line edit</button>}
    </form></div>}
    <div className="card"><h2>Review opening lines</h2>
      <div className="table-wrap" role="region" aria-label="Opening lines" tabIndex={0}><table><thead><tr><th>Category</th><th>Name / reference</th><th>Quantity</th><th>Value</th><th>Notes / source</th>{editable && <th>Actions</th>}</tr></thead><tbody>{rows.map(r => <tr key={r.ref}><td>{categories[r.kind]}</td><td>{r.name}<br />{r.serial}<br />{r.processingStage}{r.workLocation ? ` · ${r.workLocation}` : ""}</td><td>{r.weightTons ? `${r.weightTons} tons` : r.quantity ? `${r.quantity} ${r.unit ?? "slabs"}` : "—"}{r.sqftPerSlab ? ` · ${r.sqftPerSlab} sqft each` : ""}</td><td>{formatInr(r.amount)}</td><td>{r.note}<br />{r.sourceReference}</td>{editable && <td><button type="button" onClick={() => { setRow(r); setEditingRef(r.ref); }}>Edit line</button><button type="button" onClick={() => { setRows(old => old.filter(l => l.ref !== r.ref)); setDirty(true); }}>Remove line</button></td>}</tr>)}</tbody></table></div>
      {!rows.length && <p>No opening lines yet.</p>}
      {editable && <><button type="button" disabled={busy || Boolean(editingRef)} onClick={() => void save()}>Save draft</button>{dirty && <span> Unsaved changes—save before submitting.</span>}</>}
      {canWrite && current?.status === "DRAFT" && <button type="button" disabled={busy || dirty || !rows.length || Boolean(editingRef)} onClick={() => void write(`/api/v1/books/openings/${current.id}/submit`, { baseVersion: current.version })}>Submit for approval</button>}
      {canWrite && current?.status === "SUBMITTED" && <>
        <button type="button" disabled={busy} onClick={() => void write(`/api/v1/books/openings/${current.id}/reopen`, { baseVersion: current.version })}>Return to draft</button>
        <label><input type="checkbox" checked={reconciled} onChange={e => setReconciled(e.target.checked)} /> I checked existing stock and books. These opening entries are missing from StoneOS and will not duplicate records.</label>
        <button type="button" disabled={busy || !reconciled || current.enteredByIds.includes(me!.id)} onClick={() => void write(`/api/v1/books/openings/${current.id}/approve`, { baseVersion: current.version, reconciled })}>Approve opening balances</button>
        {current.enteredByIds.includes(me!.id) && <p>A different authorized user who did not enter or edit this batch must approve it.</p>}
      </>}
    </div>
    {current?.status === "APPROVED" && <section><h2>Collect or pay opening dues</h2><p>These settlements do not need an invoice. Select the actual payment mode, and separately select any pending portion it settles.</p>
      {current.lines.filter(l => l.kind === "DEBTOR" || l.kind === "CREDITOR").map(line => <Settlement key={line.id} line={line} canWrite={canWrite} onSaved={() => refresh(current.id)} onError={setError} />)}
    </section>}
  </AppShell>;
}

function Settlement({ line, canWrite, onSaved, onError }: { line: Line; canWrite: boolean; onSaved: () => Promise<void>; onError: (message: string) => void }) {
  const [amount, setAmount] = useState(""); const [date, setDate] = useState(todayIst()); const [method, setMethod] = useState("cash");
  const [note, setNote] = useState(""); const [person, setPerson] = useState(""); const [reference, setReference] = useState("");
  const [bucket, setBucket] = useState(""); const [busy, setBusy] = useState(false); const operation = useRef<string | null>(null);
  const remaining = Number(line.amount) - Number(line.settledAmount);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); onError(""); operation.current ??= crypto.randomUUID();
    try {
      await apiFetch(`/api/v1/books/openings/lines/${line.id}/settlements`, { method: "POST", onlineOnly: true, body: JSON.stringify({ amount: Number(amount), method, paidAt: date, note, receivedBy: person, reference, pendingBucket: bucket || undefined, clientOpId: operation.current }) });
      operation.current = null; setAmount(""); setNote(""); setReference(""); await onSaved();
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="card"><h3>{line.payload.name} · {line.kind === "DEBTOR" ? "Customer due" : "Supplier due"}</h3><p>Opening {formatInr(Number(line.amount))} · Remaining <strong>{formatInr(remaining)}</strong></p>
    {line.payload.note && <p>{line.payload.note}</p>}
    {canWrite && remaining > 0 && <form onSubmit={submit}>
      <label>{line.kind === "DEBTOR" ? "Amount received (₹)" : "Amount paid (₹)"}<input required type="number" min="0.01" max={remaining} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></label>
      <label>Payment date<input required type="date" max={todayIst()} value={date} onChange={e => setDate(e.target.value)} /></label>
      <label>Actual payment mode<select value={method} onChange={e => setMethod(e.target.value)}><option value="cash">Cash</option><option value="UPI">UPI</option><option value="bank transfer">Bank transfer</option><option value="cheque">Cheque</option></select></label>
      {line.kind === "DEBTOR" && <label>Settles pending portion<select value={bucket} onChange={e => setBucket(e.target.value)}><option value="">No collection-plan allocation</option><option value="cash">Cash pending</option><option value="bank">Bank / UPI pending</option></select></label>}
      <label>Received by / paid to<input maxLength={2000} value={person} onChange={e => setPerson(e.target.value)} /></label>
      <label>Transaction reference<input maxLength={2000} value={reference} onChange={e => setReference(e.target.value)} /></label>
      <label>Transaction note<textarea maxLength={2000} value={note} onChange={e => setNote(e.target.value)} /></label>
      <button type="submit" disabled={busy}>{line.kind === "DEBTOR" ? "Record opening collection" : "Record opening payment"}</button>
    </form>}
    <div className="table-wrap" role="region" aria-label={`Settlements for ${line.payload.name}`} tabIndex={0}><table><thead><tr><th>Date</th><th>Amount</th><th>Mode</th><th>Received by / paid to</th><th>Reference</th><th>Note</th></tr></thead><tbody>{line.settlements.map(p => <tr key={p.id}><td>{p.paidAt.slice(0, 10)}</td><td>{formatInr(Number(p.amount))}</td><td>{p.method}</td><td>{p.receivedBy}</td><td>{p.reference}</td><td>{p.note}</td></tr>)}</tbody></table></div>
  </div>;
}
