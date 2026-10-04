"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import {
  FINISHED_GOODS_VARIETIES,
  type FinishedGoodsInput,
} from "@stoneos/contracts";
import { apiFetch } from "../lib/api";
import { formatInr, todayIst } from "../lib/format";
import { CustomerForm } from "./CustomerForm";
type Supplier = {
  id: string;
  name: string;
  gstin: string | null;
  stateCode: string | null;
};
type Receipt = {
  id: string;
  reference: string;
  kind: string;
  varietyName: string;
  invoiceNo: string;
  purchaseDate: string;
  goodsTaxable: string;
  transportTaxable: string;
  cgst: string;
  sgst: string;
  igst: string;
  transportCgst: string;
  transportSgst: string;
  transportIgst: string;
  paidAmount: string;
  transportPaidAmount: string;
  supplier: Supplier;
  slabs: Array<{
    salesStatus: string;
    lengthFt: string;
    widthFt: string;
    purchaseCost: string;
  }>;
};
const newDraft = (): FinishedGoodsInput => ({
  reference: "",
  kind: "slab",
  varietyName: FINISHED_GOODS_VARIETIES[0],
  count: 1,
  lengthFt: 0,
  widthFt: 0,
  thicknessMm: 18,
  finish: "polished",
  supplierId: "",
  invoiceNo: "",
  purchaseDate: todayIst(),
  goodsTaxable: 0,
  gstRatePct: 18,
  paidAmount: 0,
  paymentMethod: "bank",
  transportTaxable: 0,
  transportGstRatePct: 0,
  transportPaidAmount: 0,
  transportPaymentMethod: "cash",
  clientOpId: crypto.randomUUID(),
});
const rates = [0, 0.25, 3, 5, 12, 18, 28];
export function FinishedPurchasesWorkspace() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]),
    [rows, setRows] = useState<Receipt[]>([]),
    [draft, setDraft] = useState<FinishedGoodsInput>(newDraft),
    [review, setReview] = useState<FinishedGoodsInput | null>(null),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [online, setOnline] = useState(true);
  const refresh = async () => {
    const [vendors, receipts] = await Promise.all([
      apiFetch<Supplier[]>("/api/v1/inventory/suppliers"),
      apiFetch<Receipt[]>("/api/v1/inventory/finished-purchases"),
    ]);
    setSuppliers(vendors);
    setRows(receipts);
  };
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    const net = () => setOnline(navigator.onLine);
    net();
    window.addEventListener("online", net);
    window.addEventListener("offline", net);
    return () => {
      window.removeEventListener("online", net);
      window.removeEventListener("offline", net);
    };
  }, []);
  const set = <K extends keyof FinishedGoodsInput>(
    k: K,
    v: FinishedGoodsInput[K],
  ) => setDraft((d) => ({ ...d, [k]: v }));
  const goodsTotal =
      Math.round(draft.goodsTaxable * 100) +
      Math.round(draft.goodsTaxable * draft.gstRatePct),
    transportTotal =
      Math.round(draft.transportTaxable * 100) +
      Math.round(draft.transportTaxable * draft.transportGstRatePct);
  const reviewForm = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setNotice("");
    if (
      draft.paidAmount > goodsTotal / 100 ||
      draft.transportPaidAmount > transportTotal / 100
    ) {
      setError("Payment cannot exceed its bill total including GST.");
      return;
    }
    setReview({ ...draft, clientOpId: crypto.randomUUID() });
  };
  const save = async () => {
    if (!review || busy || !online) return;
    setBusy(true);
    setError("");
    try {
      await apiFetch("/api/v1/inventory/finished-purchases", {
        method: "POST",
        onlineOnly: true,
        body: JSON.stringify(review),
      });
      setNotice(
        review.count +
          " purchased " +
          review.kind +
          " pieces received directly into finished stock.",
      );
      setReview(null);
      setRetry(false);
      setDraft(newDraft());
      await refresh().catch(() =>
        setError("Saved. Refresh to see the latest stock."),
      );
    } catch (e) {
      const f = e as Error & { status?: number };
      setError(f.message);
      setRetry(!f.status || f.status >= 500);
    } finally {
      setBusy(false);
    }
  };
  const number = (
    key:
      | "count"
      | "lengthFt"
      | "widthFt"
      | "thicknessMm"
      | "goodsTaxable"
      | "paidAmount"
      | "transportTaxable"
      | "transportPaidAmount",
    label: string,
    min = 0,
  ) => (
    <label>
      {label}
      <input
        type="number"
        min={min}
        max={key === "count" ? 1000 : undefined}
        step={key === "count" ? 1 : 0.01}
        value={
          ["paidAmount", "transportTaxable", "transportPaidAmount"].includes(
            key,
          )
            ? draft[key]
            : draft[key] || ""
        }
        required
        onChange={(e) => set(key, Number(e.target.value))}
      />
    </label>
  );
  const selectSupplier = (
    key: "supplierId" | "transportSupplierId",
    label: string,
    required = false,
  ) => (
    <label>
      {label}
      <select
        aria-label={label}
        value={draft[key] ?? ""}
        required={required}
        onChange={(e) => {
          set(key, e.target.value || (undefined as never));
          if (key === "transportSupplierId" && !e.target.value)
            set("transportInvoiceNo", undefined);
        }}
      >
        <option value="">
          {key === "supplierId"
            ? "Choose supplier"
            : "On the stone supplier bill"}
        </option>
        {suppliers.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
            {s.gstin ? " · " + s.gstin : " · unregistered"}
          </option>
        ))}
      </select>
    </label>
  );
  const rate = (key: "gstRatePct" | "transportGstRatePct", label: string) => (
    <label>
      {label}
      <select
        value={draft[key]}
        onChange={(e) => set(key, Number(e.target.value))}
      >
        {rates.map((r) => (
          <option key={r} value={r}>
            {r}%
          </option>
        ))}
      </select>
    </label>
  );
  const method = (
    key: "paymentMethod" | "transportPaymentMethod",
    label: string,
  ) => (
    <label>
      {label}
      <select value={draft[key]} onChange={(e) => set(key, e.target.value)}>
        <option value="cash">Cash</option>
        <option value="bank">Bank</option>
        <option value="upi">UPI</option>
      </select>
    </label>
  );
  return (
    <div className="finished-purchases-workspace">
      <section className="card">
        <h2>Purchased finished goods</h2>
        <p>
          Slabs and countertops go straight to finished stock. No cutting,
          polishing or royalty entry is required.
        </p>
        <p>
          <Link href="/sales">Sell from finished stock →</Link> ·{" "}
          <Link href="/books/gst">Purchase GST & sales GST →</Link> ·{" "}
          <Link href="/sales/reports?side=supplier&type=purchases">
            Supplier purchase report →
          </Link>
        </p>
        <button
          className="secondary"
          disabled={busy || !!review}
          onClick={() => refresh().catch((e) => setError(e.message))}
        >
          Refresh purchases
        </button>
      </section>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!online && (
        <p role="status">
          Connect to record a purchase with its current supplier and GST
          details.
        </p>
      )}
      {review ? (
        <section className="card cost-review">
          <h2>Review finished-goods purchase</h2>
          <dl>
            <dt>Stock</dt>
            <dd>
              {review.reference} · {review.varietyName} · {review.count}{" "}
              {review.kind} pieces · {review.lengthFt} × {review.widthFt} ft ·{" "}
              {review.thicknessMm} mm
            </dd>
            <dt>Supplier / bill</dt>
            <dd>
              {suppliers.find((s) => s.id === review.supplierId)?.name} ·{" "}
              {review.invoiceNo} · {review.purchaseDate}
            </dd>
            <dt>Goods before GST / rate</dt>
            <dd>
              {formatInr(review.goodsTaxable)} · {review.gstRatePct}%
            </dd>
            <dt>Transport before GST / rate</dt>
            <dd>
              {formatInr(review.transportTaxable)} ·{" "}
              {review.transportGstRatePct}% ·{" "}
              {suppliers.find((s) => s.id === review.transportSupplierId)
                ?.name ?? "Stone supplier bill"}{" "}
              · {review.transportInvoiceNo ?? review.invoiceNo}
            </dd>
            <dt>Stock landed cost, excluding GST</dt>
            <dd>{formatInr(review.goodsTaxable + review.transportTaxable)}</dd>
            <dt>Bill totals including GST</dt>
            <dd>
              Goods {formatInr(goodsTotal / 100)} · Transport{" "}
              {formatInr(transportTotal / 100)}
            </dd>
            <dt>Payments</dt>
            <dd>
              Goods {formatInr(review.paidAmount)} ({review.paymentMethod}) ·
              Transport {formatInr(review.transportPaidAmount)} (
              {review.transportPaymentMethod})
            </dd>
            <dt>Supplier dues created</dt>
            <dd>
              {formatInr(
                (goodsTotal + transportTotal) / 100 -
                  review.paidAmount -
                  review.transportPaidAmount,
              )}
            </dd>
          </dl>
          <p>
            One save records the received pieces, purchase bills, input GST and
            payments together.
          </p>
          <div className="cost-actions">
            <button disabled={busy || !online} onClick={save}>
              {busy
                ? "Saving…"
                : retry
                  ? "Retry same purchase"
                  : "Confirm finished purchase"}
            </button>
            <button
              className="secondary"
              disabled={busy || retry}
              onClick={() => setReview(null)}
            >
              Back to edit
            </button>
          </div>
          {retry && (
            <p>
              The reply was interrupted. Retry this same purchase reference to
              avoid a duplicate.
            </p>
          )}
        </section>
      ) : (
        <section className="card">
          <h2>Receive finished slabs / countertops</h2>
          <form onSubmit={reviewForm}>
            <fieldset>
              <legend>Finished stock</legend>
              <label>
                Purchase lot reference
                <input
                  value={draft.reference}
                  maxLength={40}
                  required
                  onChange={(e) => set("reference", e.target.value)}
                  placeholder="FG-001"
                />
              </label>
              <label>
                Product type
                <select
                  value={draft.kind}
                  onChange={(e) =>
                    set("kind", e.target.value as FinishedGoodsInput["kind"])
                  }
                >
                  <option value="slab">Finished slabs</option>
                  <option value="countertop">Countertops</option>
                </select>
              </label>
              <label>
                Finished variety
                <input
                  list="finished-varieties"
                  value={draft.varietyName}
                  required
                  onChange={(e) => set("varietyName", e.target.value)}
                />
              </label>
              <datalist id="finished-varieties">
                {FINISHED_GOODS_VARIETIES.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
              {number("count", "Pieces", 1)}
              {number("lengthFt", "Length per piece (ft)", 0.01)}
              {number("widthFt", "Width per piece (ft)", 0.01)}
              {number("thicknessMm", "Thickness (mm)", 0.01)}
              <p>
                Total area:{" "}
                {(draft.count * draft.lengthFt * draft.widthFt).toFixed(2)}{" "}
                sqft. For a different variety or size, record a separate lot
                using only its share of the bill and transport. Do not repeat
                the full bill value.
              </p>
              <label>
                Finish
                <input
                  value={draft.finish}
                  required
                  onChange={(e) => set("finish", e.target.value)}
                />
              </label>
            </fieldset>
            <fieldset>
              <legend>Stone supplier bill</legend>
              {selectSupplier("supplierId", "Stone supplier", true)}
              <label>
                Supplier invoice number
                <input
                  value={draft.invoiceNo}
                  maxLength={100}
                  required
                  onChange={(e) => set("invoiceNo", e.target.value)}
                />
              </label>
              <label>
                Invoice / purchase date
                <input
                  type="date"
                  value={draft.purchaseDate}
                  max={todayIst()}
                  required
                  onChange={(e) => set("purchaseDate", e.target.value)}
                />
              </label>
              {number(
                "goodsTaxable",
                "Goods value for these pieces before GST (₹)",
                0.01,
              )}
              {rate("gstRatePct", "GST charged on goods bill")}
              {number("paidAmount", "Paid against goods bill (₹)")}
              {method("paymentMethod", "Goods payment mode")}
            </fieldset>
            <fieldset>
              <legend>Inward transport</legend>
              {number("transportTaxable", "Transport charge before GST (₹)")}
              {selectSupplier("transportSupplierId", "Transport billed by")}
              {draft.transportSupplierId && (
                <label>
                  Transport invoice number
                  <input
                    value={draft.transportInvoiceNo ?? ""}
                    required={draft.transportTaxable > 0}
                    onChange={(e) => set("transportInvoiceNo", e.target.value)}
                  />
                </label>
              )}
              {rate("transportGstRatePct", "GST charged on transport bill")}
              {number("transportPaidAmount", "Paid against transport (₹)")}
              {method("transportPaymentMethod", "Transport payment mode")}
              <p>
                Use the GST rate actually charged on the bill. Zero means no
                supplier GST charged; reverse-charge tax is reviewed separately.
              </p>
            </fieldset>
            <div className="cost-summary-grid">
              <div className="metric">
                <span>Stock landed cost before GST</span>
                <b>{formatInr(draft.goodsTaxable + draft.transportTaxable)}</b>
              </div>
              <div className="metric">
                <span>GST charged</span>
                <b>
                  {formatInr(
                    (goodsTotal + transportTotal) / 100 -
                      draft.goodsTaxable -
                      draft.transportTaxable,
                  )}
                </b>
              </div>
            </div>
            <p>
              Regular GST: recorded purchase tax goes to input GST heads and
              sales tax to output heads. Match bills and credit eligibility
              before return filing.
            </p>
            <button disabled={busy || !online}>Review finished purchase</button>
          </form>
        </section>
      )}
      {!review && (
        <details className="card">
          <summary>Add a supplier or transporter</summary>
          <CustomerForm
            kind="supplier"
            onAdded={() => refresh().catch((e) => setError(e.message))}
          />
        </details>
      )}
      <section className="card">
        <h2>Finished purchase register</h2>
        {rows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Reference / bill / date</th>
                  <th>Variety / product / supplier</th>
                  <th>Available / received</th>
                  <th>Goods + transport before GST</th>
                  <th>Input GST recorded</th>
                  <th>Paid at receipt</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr id={"finished-" + r.id} key={r.id}>
                    <td>
                      {r.reference}
                      <br />
                      {r.invoiceNo} · {r.purchaseDate.slice(0, 10)}
                    </td>
                    <td>
                      {r.varietyName} · {r.kind}
                      <br />
                      {r.supplier.name}
                    </td>
                    <td>
                      {
                        r.slabs.filter((s) => s.salesStatus === "in_stock")
                          .length
                      }{" "}
                      / {r.slabs.length}
                    </td>
                    <td>
                      {formatInr(
                        Number(r.goodsTaxable) + Number(r.transportTaxable),
                      )}
                    </td>
                    <td>
                      {formatInr(
                        [
                          r.cgst,
                          r.sgst,
                          r.igst,
                          r.transportCgst,
                          r.transportSgst,
                          r.transportIgst,
                        ].reduce((n, v) => n + Number(v), 0),
                      )}
                    </td>
                    <td>
                      {formatInr(
                        Number(r.paidAmount) + Number(r.transportPaidAmount),
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No finished-goods purchases yet.</p>
        )}
      </section>
    </div>
  );
}
