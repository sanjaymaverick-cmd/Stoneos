"use client";
import { ROUGH_BLOCK_VARIETIES } from "@stoneos/contracts";

import { FinishedPurchasesWorkspace } from "../../components/FinishedPurchasesWorkspace";
import { BlockCostsWorkspace } from "../../components/BlockCostsWorkspace";
import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { attachFile, Attachments } from "../../components/Attachments";
import { ref } from "../../lib/api";
import { VarietyChips } from "../../components/VarietyChips";
import { AppShell } from "../../components/AppShell";
import { CustomerForm } from "../../components/CustomerForm";
import { EmptyState } from "../../components/EmptyState";
import { apiFetch, isQueued } from "../../lib/api";
import { bodyOf, queuedAt, useOutbox } from "../../lib/useOutbox";
import { formatInr, slabLabel, slabSqft } from "../../lib/format";

type Slab = {
  id: string;
  slabSerial: string;
  parentBlockId?: string;
  finishedPurchaseId?: string;
  finishedPurchase?: { id: string; reference: string; kind: string };
  parentBlock?: { serialNumber: string };
  finish?: string;
  location?: { code: string };
  salesStatus: string;
  varietyName?: string | null;
  lengthFt?: string | null;
  widthFt?: string | null;
  thicknessMm?: number | null;
};

export default function InventoryPage() {
  const [blocks, setBlocks] = useState<
    Array<{
      id: string;
      serialNumber: string;
      varietyName: string;
      currentStatus: string;
      purchaseTaxable?: string | number | null;
      purchaseCashAmount?: string | number | null;
    }>
  >([]);
  const [owner, setOwner] = useState(false);
  const [view, setView] = useState("stock");
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [costBlockId, setCostBlockId] = useState<string>();
  const [bill, setBill] = useState<File | null>(null);

  // Correcting a block taken in before the form asked for a cash amount.
  const [fixBlock, setFixBlock] = useState("");
  const [fixCash, setFixCash] = useState("");
  const [fixReason, setFixReason] = useState("");
  const [fixNotice, setFixNotice] = useState("");
  const [fixError, setFixError] = useState("");
  const fixOp = useRef(crypto.randomUUID());
  const [search, setSearch] = useState("");
  const [varietyFilter, setVarietyFilter] = useState("");
  const [finishFilter, setFinishFilter] = useState("");
  const [receiveReview, setReceiveReview] = useState(false);
  const [receivedOn, setReceivedOn] = useState(() =>
    new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }),
  );
  const [serialNumber, setSerial] = useState("");
  const [varietyName, setVariety] = useState<string>(ROUGH_BLOCK_VARIETIES[0]);
  const [weightTons, setWeightTons] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [quarry, setQuarry] = useState("");
  const [blockPricePerTon, setBlockPricePerTon] = useState("");
  const [royaltyPerTon, setRoyaltyPerTon] = useState("");
  const [transportPerTon, setTransportPerTon] = useState("");
  const [purchaseGstRate, setPurchaseGstRate] = useState(5);
  const [purchaseTaxable, setPurchaseTaxable] = useState("");
  const [purchasePaid, setPurchasePaid] = useState("");
  const [purchasePaymentMethod, setPurchasePaymentMethod] = useState("cash");
  const [purchaseCash, setPurchaseCash] = useState("");
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState("");
  const [suppliers, setSuppliers] = useState<
    Array<{ id: string; name: string; gstin?: string | null }>
  >([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const { items, refresh: refreshQueue } = useOutbox();
  const queuedBlocks = queuedAt(items, "/api/v1/inventory/raw-blocks");
  const [page, setPage] = useState(1);
  const [blockPage, setBlockPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [blockTotal, setBlockTotal] = useState(0);
  const [stockStatus, setStockStatus] = useState("in_stock");
  const [slabs, setSlabs] = useState<Slab[]>([]);
  const receiveOp = useRef(crypto.randomUUID());

  const loadVersion = useRef(0);
  const filterKey = JSON.stringify([
    page,
    blockPage,
    search,
    varietyFilter,
    finishFilter,
    stockStatus,
  ]);
  const currentFilter = useRef(filterKey);
  currentFilter.current = filterKey;

  async function refresh() {
    const version = ++loadVersion.current;
    const requestedFilter = filterKey;
    const filters = new URLSearchParams({
      page: String(page),
      pageSize: "50",
      q: search,
      variety: varietyFilter,
      finish: finishFilter,
      salesStatus: stockStatus,
    });
    const [raw, finished] = await Promise.all([
      apiFetch<{ items: typeof blocks; total: number }>(
        `/api/v1/inventory/raw-blocks?page=${blockPage}&pageSize=50&q=${encodeURIComponent(search)}`,
      ),
      apiFetch<{ items: Slab[]; total: number }>(
        `/api/v1/inventory/slabs?${filters}`,
      ),
    ]);
    if (
      version !== loadVersion.current ||
      requestedFilter !== currentFilter.current
    )
      return;
    setBlocks(raw.items);
    setBlockTotal(raw.total);
    setSlabs(finished.items);
    setTotal(finished.total);
    setSuppliers(await apiFetch("/api/v1/inventory/suppliers").catch(() => []));
  }
  useEffect(() => {
    refresh().catch(() => undefined);
    apiFetch<{ role: string }>("/api/v1/auth/me")
      .then((u) => setOwner(u.role === "owner"))
      .catch(() => undefined);
    const requestedView = new URLSearchParams(location.search).get("view");
    if (["costs", "finished"].includes(requestedView ?? ""))
      setView(requestedView!);
  }, []);

  useEffect(() => {
    const timer = setTimeout(
      () =>
        refresh().catch((err) =>
          setError(err instanceof Error ? err.message : "Could not load stock"),
        ),
      250,
    );
    return () => clearTimeout(timer);
  }, [page, blockPage, search, varietyFilter, finishFilter, stockStatus]);

  const numeric = (v: unknown) => Number(v ?? 0) || 0;
  const chosen = blocks.find((b) => b.serialNumber === fixBlock);

  async function correctCash(event: FormEvent) {
    event.preventDefault();
    setFixNotice("");
    setFixError("");
    try {
      const result = (await apiFetch(
        "/api/v1/inventory/raw-blocks/correct-cash",
        {
          method: "POST",
          label: `Cash on ${fixBlock}`,
          body: JSON.stringify({
            blockSerial: fixBlock,
            purchaseCashAmount: Number(fixCash),
            reason: fixReason.trim(),
            clientOpId: fixOp.current,
          }),
        },
      )) as {
        previousCashAmount?: number;
        costBasis?: number;
        costPerSlab?: number;
        goodSlabCount?: number;
      };
      fixOp.current = crypto.randomUUID();
      setFixNotice(
        isQueued(result)
          ? `Correction to ${fixBlock} saved on this device; it will sync.`
          : `${fixBlock}: cash ${formatInr(result.previousCashAmount ?? 0)} → ` +
              `${formatInr(Number(fixCash))}. Cost basis ${formatInr(result.costBasis ?? 0)}` +
              (result.goodSlabCount
                ? `, ${formatInr(result.costPerSlab ?? 0)} a slab.`
                : " (no cut recorded yet)."),
      );
      setFixCash("");
      setFixReason("");
      await refresh().catch(() => undefined);
    } catch (err) {
      setFixError(err instanceof Error ? err.message : "Correction failed");
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!receiveReview) {
      setReceiveReview(true);
      return;
    }
    setError("");
    setNotice("");
    try {
      if (
        Number(purchaseTaxable) > 0 &&
        purchaseGstRate > 0 &&
        !suppliers.find((supplier) => supplier.id === supplierId)?.gstin
      ) {
        throw new Error(
          "Select a supplier with GSTIN before recording purchase GST.",
        );
      }
      const result = await apiFetch("/api/v1/inventory/raw-blocks", {
        method: "POST",
        label: `Receive block ${serialNumber}`,
        body: JSON.stringify({
          serialNumber,
          varietyName,
          occurredAt: receivedOn + "T00:00:00+05:30",
          gstRatePct: purchaseGstRate,
          weightTons: Number(weightTons),
          blockPricePerTon: blockPricePerTon
            ? Number(blockPricePerTon)
            : undefined,
          royaltyPerTon: royaltyPerTon ? Number(royaltyPerTon) : undefined,
          transportPerTon: transportPerTon
            ? Number(transportPerTon)
            : undefined,
          supplierId: supplierId || undefined,
          quarry: quarry.trim() || undefined,
          purchaseTaxable: purchaseTaxable
            ? Number(purchaseTaxable)
            : undefined,
          purchaseCashAmount: purchaseCash ? Number(purchaseCash) : undefined,
          supplierInvoiceNo: supplierInvoiceNo.trim() || undefined,
          actualAmountPaid: purchasePaid ? Number(purchasePaid) : undefined,
          purchasePaymentMethod: purchasePaid
            ? purchasePaymentMethod
            : undefined,
          clientOpId: receiveOp.current,
        }),
      });
      if (bill) {
        await attachFile(
          bill,
          "block",
          isQueued(result)
            ? ref(receiveOp.current, "block.id")
            : result.block.id,
        );
        setBill(null);
      }
      receiveOp.current = crypto.randomUUID();
      setNotice(
        isQueued(result)
          ? `Block ${serialNumber} saved on this phone. It can go to the saw now and syncs when online.`
          : `Block ${serialNumber} received (${weightTons} t).`,
      );
      setSerial("");
      setWeightTons("");
      setPurchaseTaxable("");
      setBlockPricePerTon("");
      setRoyaltyPerTon("");
      setTransportPerTon("");
      setPurchaseCash("");
      setPurchasePaid("");
      setSupplierInvoiceNo("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Receive failed");
    }
    setReceiveReview(false);
    await Promise.all([refresh().catch(() => undefined), refreshQueue()]);
  }

  const yardSlabs = slabs;

  return (
    <AppShell>
      <h1>Yard</h1>
      {owner && (
        <div className="yard-tabs" role="group" aria-label="Yard workspace">
          <button
            aria-pressed={view === "stock"}
            className={view === "stock" ? "" : "secondary"}
            onClick={() => {
              setView("stock");
              void refresh();
            }}
          >
            Stock
          </button>
          <button
            aria-pressed={view === "costs"}
            className={view === "costs" ? "" : "secondary"}
            onClick={() => setView("costs")}
          >
            Block costs
          </button>
          <button
            aria-pressed={view === "finished"}
            className={view === "finished" ? "" : "secondary"}
            onClick={() => setView("finished")}
          >
            Buy finished goods
          </button>
        </div>
      )}
      {owner && view === "finished" ? (
        <FinishedPurchasesWorkspace />
      ) : owner && view === "costs" ? (
        <BlockCostsWorkspace initialBlockId={costBlockId} />
      ) : (
        <>
          <p>
            <button
              onClick={() => {
                setReceiveOpen(true);
                setTimeout(
                  () =>
                    document
                      .getElementById("receive-block")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" }),
                  0,
                );
              }}
            >
              Receive raw block
            </button>
          </p>
          <p>
            <Link href="/lots">
              Lots — stock by block, record a cut, write off breakage →
            </Link>
          </p>
          <div className="card">
            <h2>Stock by block or finished purchase</h2>
            <div className="yard-search">
              <label>
                Search
                <input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                    setBlockPage(1);
                  }}
                  placeholder="Block, slab or variety"
                />
              </label>
              <VarietyChips
                value={varietyFilter}
                onChange={(value) => {
                  setVarietyFilter(value);
                  setPage(1);
                }}
                options={[
                  ...ROUGH_BLOCK_VARIETIES,
                  ...slabs.map((s) => s.varietyName ?? "").filter(Boolean),
                ]}
              />
              <label>
                Finish
                <select
                  value={finishFilter}
                  onChange={(e) => {
                    setFinishFilter(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">All finishes</option>
                  {Array.from(
                    new Set([
                      "rough",
                      "honed",
                      "glossy",
                      ...slabs.map((s) => s.finish).filter(Boolean),
                    ]),
                  ).map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Status
              <select
                value={stockStatus}
                onChange={(e) => {
                  setStockStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="in_stock">In stock</option>
                <option value="">All statuses</option>
                <option value="reserved">Reserved</option>
                <option value="dispatched">Dispatched</option>
              </select>
            </label>
            <div className="pager" role="group" aria-label="Slab pages">
              <button
                className="secondary"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </button>
              <span>
                {" "}
                Page {page} of {Math.max(1, Math.ceil(total / 50))}  /  {total}{" "}
                slabs{" "}
              </span>
              <button
                className="secondary"
                disabled={page * 50 >= total}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
            {yardSlabs.length === 0 ? (
              <EmptyState>
                No slabs match these filters. Receive finished purchases or
                complete a cutting session.
              </EmptyState>
            ) : (
              <>
                {Array.from(
                  new Set(
                    yardSlabs.map(
                      (s) => s.parentBlockId ?? s.finishedPurchaseId ?? "loose",
                    ),
                  ),
                ).map((id) => (
                  <section key={id}>
                    <h3>
                      {yardSlabs.find((s) => s.parentBlockId === id)
                        ?.parentBlock?.serialNumber ??
                        yardSlabs.find((s) => s.finishedPurchaseId === id)
                          ?.finishedPurchase?.reference ??
                        "Loose slabs"}
                    </h3>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Slab</th>
                            <th>Size</th>
                            <th>Sqft</th>
                            <th>Thickness</th>
                            <th>Finish</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {yardSlabs
                            .filter(
                              (s) =>
                                (s.parentBlockId ??
                                  s.finishedPurchaseId ??
                                  "loose") === id,
                            )
                            .map((s, i) => (
                              <tr key={s.id}>
                                <td>
                                  {i + 1} · {slabLabel(s).split(" · ")[0]}
                                </td>
                                <td>
                                  {s.lengthFt ?? "—"} × {s.widthFt ?? "—"} ft
                                </td>
                                <td>{slabSqft(s) ?? "—"}</td>
                                <td>{s.thicknessMm} mm</td>
                                <td>{s.finish ?? "unpolished"}</td>
                                <td>
                                  {s.salesStatus === "in_stock"
                                    ? "in yard"
                                    : s.salesStatus.replaceAll("_", " ")}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                ))}
              </>
            )}
          </div>
          <div className="card">
            <h2>Raw blocks</h2>
            <div className="pager" role="group" aria-label="Raw block pages">
              <button
                className="secondary"
                disabled={blockPage === 1}
                onClick={() => setBlockPage(blockPage - 1)}
              >
                Previous
              </button>
              <span>
                {" "}
                Page {blockPage} of {Math.max(1, Math.ceil(blockTotal / 50))}  / {" "}
                {blockTotal} blocks{" "}
              </span>
              <button
                className="secondary"
                disabled={blockPage * 50 >= blockTotal}
                onClick={() => setBlockPage(blockPage + 1)}
              >
                Next
              </button>
            </div>
            {blocks.length === 0 && queuedBlocks.length === 0 ? (
              <EmptyState>
                No raw blocks match this search. Use Receive raw block to add
                stock.
              </EmptyState>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Serial</th>
                      <th>Variety</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queuedBlocks.map((q) => {
                      const body = bodyOf<{
                        serialNumber: string;
                        varietyName: string;
                      }>(q);
                      return (
                        <tr key={q.clientOpId}>
                          <td>{body.serialNumber}</td>
                          <td>{body.varietyName}</td>
                          <td>
                            <span className="pending-tag">not synced</span>
                          </td>
                        </tr>
                      );
                    })}
                    {blocks
                      .filter((b) => !/^BAD-(ZERO|NEG)$/.test(b.serialNumber))
                      .map((b) => (
                        <tr key={b.id}>
                          <td>
                            {b.serialNumber}
                            {owner && (
                              <button
                                className="secondary"
                                onClick={() => {
                                  setCostBlockId(b.id);
                                  setView("costs");
                                }}
                              >
                                Review costs →
                              </button>
                            )}
                          </td>
                          <td>{b.varietyName}</td>
                          <td>
                            {b.currentStatus === "under_cutting"
                              ? "on saw"
                              : b.currentStatus === "in_stock"
                                ? "in yard"
                                : b.currentStatus.replaceAll("_", " ")}
                            <Attachments type="block" id={b.id} />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <details
            id="receive-block"
            className="card"
            open={receiveOpen}
            onToggle={(e) => setReceiveOpen(e.currentTarget.open)}
          >
            <summary>Receive raw block</summary>
            <form onSubmit={onSubmit} onChange={() => setReceiveReview(false)}>
              <fieldset>
                <legend>Block identity and receipt</legend>
                <label>
                  Receipt date
                  <input
                    type="date"
                    value={receivedOn}
                    onChange={(e) => setReceivedOn(e.target.value)}
                    required
                  />
                </label>
                <label>
                  Serial
                  <input
                    value={serialNumber}
                    onChange={(e) => setSerial(e.target.value)}
                    required
                  />
                </label>
                <label>
                  Variety
                  <input
                    list="rough-block-varieties"
                    value={varietyName}
                    onChange={(e) => setVariety(e.target.value)}
                    required
                  />
                </label>
                <datalist id="rough-block-varieties">
                  {ROUGH_BLOCK_VARIETIES.map((v) => (
                    <option key={v} value={v} />
                  ))}
                </datalist>
                <label>
                  Weight (tons)
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0.01"
                    max="60"
                    value={weightTons}
                    onChange={(e) => setWeightTons(e.target.value)}
                    required
                  />
                </label>
              </fieldset>
              <fieldset>
                <legend>Supplier and payment</legend>
                <label>
                  Supplier
                  <select
                    value={supplierId}
                    onChange={(e) => {
                      setSupplierId(e.target.value);
                      setPurchaseGstRate(
                        suppliers.find((s) => s.id === e.target.value)?.gstin
                          ? 5
                          : 0,
                      );
                    }}
                  >
                    <option value="">Not recorded</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Paid against purchase bill
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={purchasePaid}
                    onChange={(e) => setPurchasePaid(e.target.value)}
                  />
                </label>
                <label>
                  Purchase payment mode
                  <select
                    value={purchasePaymentMethod}
                    onChange={(e) => setPurchasePaymentMethod(e.target.value)}
                  >
                    <option value="cash">Cash</option>
                    <option value="UPI">UPI</option>
                    <option value="bank transfer">Bank transfer</option>
                    <option value="cheque">Cheque</option>
                  </select>
                </label>
                <label>
                  Quarry
                  <input
                    value={quarry}
                    onChange={(e) => setQuarry(e.target.value)}
                    placeholder="Pit or location"
                  />
                </label>
              </fieldset>
              <fieldset>
                <legend>Block costs per ton</legend>
                <label>
                  Block price (₹/ton)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={blockPricePerTon}
                    onChange={(e) => setBlockPricePerTon(e.target.value)}
                  />
                </label>
                <label>
                  Block royalty (₹/ton)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={royaltyPerTon}
                    onChange={(e) => setRoyaltyPerTon(e.target.value)}
                  />
                </label>
                <label>
                  Block transport rent (₹/ton)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={transportPerTon}
                    onChange={(e) => setTransportPerTon(e.target.value)}
                  />
                </label>
                <p>
                  Rates × recorded tonnage. Leave rates blank when unknown.
                  Royalty and transport are cost estimates until their expenses
                  are entered and allocated.
                </p>
                {blockPricePerTon && weightTons && (
                  <p>
                    Stone price:{" "}
                    {formatInr(Number(blockPricePerTon) * Number(weightTons))} ·
                    Royalty:{" "}
                    {formatInr(Number(royaltyPerTon || 0) * Number(weightTons))}{" "}
                    · Transport:{" "}
                    {formatInr(
                      Number(transportPerTon || 0) * Number(weightTons),
                    )}
                  </p>
                )}
              </fieldset>
              <fieldset>
                <legend>Purchase bill and cash cost</legend>
                <label>
                  Value before GST (₹)
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="1"
                    value={purchaseTaxable}
                    onChange={(e) => setPurchaseTaxable(e.target.value)}
                  />
                </label>
                <label>
                  GST charged on block bill
                  <select
                    value={purchaseGstRate}
                    onChange={(e) => setPurchaseGstRate(Number(e.target.value))}
                  >
                    {[0, 0.25, 3, 5, 12, 18, 28].map((r) => (
                      <option key={r} value={r}>
                        {r}%
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Paid in cash, no bill (₹)
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="1"
                    value={purchaseCash}
                    onChange={(e) => setPurchaseCash(e.target.value)}
                  />
                </label>
                <p className="muted">
                  Cash carries no GST, so there is no input credit to claim on
                  it — but it is still what the stone cost, so it counts towards
                  the cost of every slab off this block.
                </p>
                {purchaseTaxable || purchaseCash ? (
                  <p className="hint">
                    Cost basis{" "}
                    {formatInr(
                      Number(purchaseTaxable || 0) + Number(purchaseCash || 0),
                    )}
                    {weightTons
                      ? ` · ${formatInr(
                          (Number(purchaseTaxable || 0) +
                            Number(purchaseCash || 0)) /
                            Number(weightTons),
                        )} per ton`
                      : ""}
                    {purchaseTaxable
                      ? ` · ${purchaseGstRate}% GST on the billed part`
                      : ""}
                  </p>
                ) : null}
                <label>
                  Supplier bill no.
                  <input
                    value={supplierInvoiceNo}
                    onChange={(e) => setSupplierInvoiceNo(e.target.value)}
                  />
                </label>
                <label>
                  Optional bill photo
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    onChange={(e) => setBill(e.target.files?.[0] ?? null)}
                  />
                </label>
              </fieldset>
              {error ? (
                <p className="error" role="alert">
                  {error}
                </p>
              ) : null}
              {notice ? (
                <p className="muted" role="status">
                  {notice}
                </p>
              ) : null}
              {receiveReview && (
                <section aria-label="Review block receipt" className="hint">
                  <h3>Review before saving</h3>
                  <p>
                    {serialNumber} / {varietyName} / {weightTons} tons /{" "}
                    {receivedOn}
                  </p>
                  <p>
                    Supplier:{" "}
                    {suppliers.find((supplier) => supplier.id === supplierId)
                      ?.name ?? "Not recorded"}
                  </p>
                  <p>
                    Net stone cost{" "}
                    {formatInr(
                      Number(purchaseTaxable || 0) + Number(purchaseCash || 0),
                    )}
                    ; bill GST {purchaseGstRate}%; paid against bill{" "}
                    {formatInr(Number(purchasePaid || 0))} by{" "}
                    {purchasePaymentMethod}.
                  </p>
                  <p>
                    Royalty and transport estimates are confirmed separately
                    through Block costs.
                  </p>
                </section>
              )}
              <button type="submit">
                {receiveReview ? "Confirm receipt" : "Review receipt"}
              </button>
            </form>
            <CustomerForm
              kind="supplier"
              heading="Add a supplier"
              onAdded={(_result, message) => {
                setNotice(message);
                void refresh().catch(() => undefined);
              }}
            />
            <p>
              <Link href="/parties">Manage buyers & suppliers →</Link>
            </p>
          </details>
          <details className="card">
            <summary>Correct cash on an older block</summary>
            <p className="muted">
              Blocks taken in before this screen asked for a cash amount carry
              none, so what each of their slabs cost is understated. Put the
              real figure in here. Only the cash part — changing the billed
              amount would mean amending the vendor&apos;s bill and the GST
              credit claimed on it.
            </p>
            {fixNotice ? <p className="hint">{fixNotice}</p> : null}
            {fixError ? <p className="error">{fixError}</p> : null}
            <p className="muted">
              Use the Yard search to find older blocks before selecting one
              below.
            </p>
            <form onSubmit={correctCash}>
              <label>
                Block
                <select
                  value={fixBlock}
                  onChange={(e) => setFixBlock(e.target.value)}
                >
                  <option value="">Choose a block</option>
                  {blocks.map((b) => (
                    <option key={b.id} value={b.serialNumber}>
                      {b.serialNumber} · {b.varietyName} ·{" "}
                      {numeric(b.purchaseCashAmount)
                        ? `${formatInr(numeric(b.purchaseCashAmount))} cash on record`
                        : "no cash recorded"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Cash actually paid (₹)
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="1"
                  value={fixCash}
                  onChange={(e) => setFixCash(e.target.value)}
                />
              </label>
              <label>
                Why it is being changed
                <input
                  value={fixReason}
                  onChange={(e) => setFixReason(e.target.value)}
                  placeholder="cash leg was never entered at receipt"
                />
              </label>
              <button
                type="submit"
                disabled={!fixBlock || fixCash === "" || !fixReason.trim()}
              >
                Correct it
              </button>
            </form>
            {chosen ? (
              <p className="hint">
                {chosen.serialNumber}:{" "}
                {formatInr(numeric(chosen.purchaseTaxable))} on the bill,{" "}
                {formatInr(numeric(chosen.purchaseCashAmount))} cash on record
                {fixCash !== "" ? (
                  <>
                    {" "}
                    → cost basis would become{" "}
                    <b>
                      {formatInr(
                        numeric(chosen.purchaseTaxable) + Number(fixCash || 0),
                      )}
                    </b>
                  </>
                ) : null}
                .
              </p>
            ) : null}
            <p className="muted">
              The difference is posted to the books against your name, with the
              reason. Breakage already written off keeps the value it was
              written off at — correcting it now would restate months that may
              already be filed.
            </p>
          </details>
        </>
      )}
    </AppShell>
  );
}
