"use client";

/*
 * Sell by the lot, then bill it.
 *
 * Pick a block and a count, add it, pick another — "80 from VG-101, 70 from VG-102" —
 * and the whole basket becomes one order and one tax invoice. Nothing here asks which
 * individual slabs are going, because the yard does not know and does not need to.
 *
 * The bill is rendered after issue from what the server stored, not from the basket:
 * a tax invoice is a document, and what it says must be what was recorded.
 */

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "../../../components/AppShell";
import { CustomerForm } from "../../../components/CustomerForm";
import { EmptyState } from "../../../components/EmptyState";
import { apiFetch, isQueued } from "../../../lib/api";
import { formatInr, todayIst } from "../../../lib/format";

type Lot = {
  blockId: string;
  blockSerial: string;
  /** "VG01-70" — the block and what is left on it. */
  label: string;
  variety: string;
  availableSlabs: number;
  polishedSlabCount: number;
  sqftPerSlab: number;
};
type Availability = { lots: Lot[] };
type Customer = { id: string; name: string; gstin?: string | null; stateCode?: string | null };

type BasketLine = {
  key: string;
  blockSerial: string;
  variety: string;
  slabCount: number;
  sqftPerSlab: number;
  rate: number;
  hsnCode: string;
  gstRatePct: number;
  description: string;
};

type OrderResult = {
  orderId: string;
  customer: string;
  taxableAmount: number;
  billingMode: string;
  cashAmount: number;
  lines: Array<{ blockSerial: string | null; slabCount: number | null }>;
};

type Bill = {
  invoiceNumber: string;
  seller: { legalName: string | null; gstin: string | null; stateCode: string | null };
  billTo: { name: string; address: string | null; gstin: string | null; stateCode: string | null };
  shipTo: { name: string | null; address: string | null; gstin: string | null; stateCode: string | null };
  placeOfSupply: string | null;
  interState: boolean;
  items: Array<{
    blockSerial: string | null;
    description: string | null;
    hsnCode: string | null;
    slabCount: number | null;
    quantitySqft: number;
    rate: number;
    gstRatePct: number;
    amount: number;
  }>;
  hsnSummary: Array<{
    hsnCode: string;
    gstRatePct: number;
    taxableAmount: number;
    cgstAmount: number;
    sgstAmount: number;
    igstAmount: number;
  }>;
  totals: {
    taxableAmount: number;
    cgstAmount: number;
    sgstAmount: number;
    igstAmount: number;
    payable: number;
  };
};

/** The statutory slabs, as the GST schedule sets them. */
const RATES = [0, 0.25, 3, 5, 12, 18, 28];
/** What Vedam sells, with the rate each HSN attracts. */
const HSN_CHOICES = [
  { code: "6802", label: "6802 — polished / worked granite", rate: 18 },
  { code: "2516", label: "2516 — rough or unworked granite", rate: 5 },
];

export default function SellLotsPage() {
  const [lots, setLots] = useState<Lot[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const [order, setOrder] = useState<OrderResult | null>(null);
  const [bill, setBill] = useState<Bill | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  // The line being added
  const [blockSerial, setBlockSerial] = useState("");
  const [slabCount, setSlabCount] = useState("");
  const [rate, setRate] = useState("");
  const [hsnCode, setHsnCode] = useState(HSN_CHOICES[0]!.code);
  const [gstRatePct, setGstRatePct] = useState(String(HSN_CHOICES[0]!.rate));
  const [description, setDescription] = useState("");

  // What is settled in cash against no bill, for the whole sale.
  const [cashAmount, setCashAmount] = useState("");
  const [cashNote, setCashNote] = useState("");

  // The date that goes ON the bill. The GST return is filed by it, so a bill
  // written yesterday and entered this morning must still say yesterday.
  const [invoiceDate, setInvoiceDate] = useState(todayIst());

  // Consignee
  const [shipName, setShipName] = useState("");
  const [shipAddress, setShipAddress] = useState("");
  const [shipGstin, setShipGstin] = useState("");
  const [shipState, setShipState] = useState("");

  const opIds = useRef<Record<string, string>>({});
  function stableOp(key: string) {
    opIds.current[key] ??= crypto.randomUUID();
    return opIds.current[key];
  }

  const load = useCallback(async () => {
    const [available, people] = await Promise.all([
      apiFetch<Availability>("/api/v1/lots/available"),
      apiFetch<Customer[]>("/api/v1/customers"),
    ]);
    setLots(available.lots);
    setCustomers(people);
  }, []);

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, [load]);

  /** How many of this lot the basket has already claimed. */
  const claimed = (serial: string) =>
    basket.filter((l) => l.blockSerial === serial).reduce((n, l) => n + l.slabCount, 0);

  const remaining = (lot: Lot) => lot.availableSlabs - claimed(lot.blockSerial);

  function pickHsn(code: string) {
    setHsnCode(code);
    const found = HSN_CHOICES.find((h) => h.code === code);
    if (found) setGstRatePct(String(found.rate));
  }

  function addLine(event: FormEvent) {
    event.preventDefault();
    setError("");
    const lot = lots.find((l) => l.blockSerial === blockSerial);
    if (!lot) return setError("Choose a lot");
    const count = Number(slabCount);
    const free = remaining(lot);
    // Checked here so the clerk sees it before sending; the server checks again,
    // and the server is the one that decides.
    if (!Number.isInteger(count) || count <= 0) return setError("Slab count must be a whole number");
    if (count > free) {
      return setError(
        `${lot.blockSerial} has ${free} slab${free === 1 ? "" : "s"} left to give${
          claimed(lot.blockSerial) ? " after what is already in this sale" : ""
        }`,
      );
    }
    if (rate.trim() === "" || Number(rate) < 0 || !Number.isFinite(Number(rate))) {
      return setError("Enter a rate per sqft — 0 only if the whole sale is in cash");
    }

    setBasket((rows) => [
      ...rows,
      {
        key: crypto.randomUUID(),
        blockSerial: lot.blockSerial,
        variety: lot.variety,
        slabCount: count,
        sqftPerSlab: lot.sqftPerSlab,
        rate: Number(rate),
        hsnCode,
        gstRatePct: Number(gstRatePct),
        description: description.trim(),
      },
    ]);
    setSlabCount("");
    setDescription("");
  }

  const lineSqft = (l: BasketLine) => Math.round(l.slabCount * l.sqftPerSlab * 100) / 100;
  const lineAmount = (l: BasketLine) => Math.round(lineSqft(l) * l.rate * 100) / 100;
  const basketTaxable = basket.reduce((n, l) => n + lineAmount(l), 0);
  /** Indicative only: the server computes the tax that counts, per HSN and rate. */
  const basketTax = basket.reduce((n, l) => n + (lineAmount(l) * l.gstRatePct) / 100, 0);
  const cash = Number(cashAmount || 0);

  async function confirmSale(event: FormEvent) {
    event.preventDefault();
    setNotice("");
    setError("");
    try {
      const result = await apiFetch<OrderResult>("/api/v1/lots/sell", {
        method: "POST",
        label: `Lot sale · ${customers.find((c) => c.id === customerId)?.name ?? ""}`,
        body: JSON.stringify({
          customerId,
          orderDate: todayIst(),
          clientOpId: stableOp("sell"),
          cashAmount: cash > 0 ? cash : undefined,
          cashNote: cashNote.trim() || undefined,
          lines: basket.map((l) => ({
            blockSerial: l.blockSerial,
            slabCount: l.slabCount,
            rate: l.rate,
            hsnCode: l.hsnCode,
            gstRatePct: l.gstRatePct,
            description: l.description || undefined,
          })),
        }),
      });
      if (isQueued(result)) {
        setNotice("Sale saved on this device. It will sync, then it can be invoiced.");
        setBasket([]);
        return;
      }
      delete opIds.current.sell;
      setOrder(result);
      setBasket([]);
      setCashAmount("");
      setCashNote("");
      setNotice(
        result.cashAmount > 0
          ? `Sale confirmed for ${result.customer}. Stock deducted. ` +
            `${formatInr(result.cashAmount)} recorded as cash with no bill.`
          : `Sale confirmed for ${result.customer}. Stock deducted.`,
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function makeInvoice() {
    if (!order) return;
    setNotice("");
    setError("");
    try {
      const result = await apiFetch<Bill>("/api/v1/lots/invoice", {
        method: "POST",
        label: `Invoice · ${order.customer}`,
        body: JSON.stringify({
          orderId: order.orderId,
          clientOpId: stableOp(`inv:${order.orderId}`),
          invoiceDate,
          shipTo:
            shipName || shipAddress || shipGstin || shipState
              ? {
                  name: shipName || undefined,
                  address: shipAddress || undefined,
                  gstin: shipGstin || undefined,
                  stateCode: shipState || undefined,
                }
              : undefined,
        }),
      });
      if (isQueued(result)) {
        setNotice("Invoice queued on this device; the number is issued when it syncs.");
        return;
      }
      setBill(result);
      setOrder(null);
      setNotice(`Invoice ${result.invoiceNumber} raised.`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <AppShell>
      <div className="page">
        <div className="dash-head">
          <h1>Sell by lot</h1>
          <p className="muted">
            Choose a block and how many slabs go. Add as many lots as the load needs,
            then bill them together.
          </p>
        </div>

        {notice ? <p className="hint">{notice}</p> : null}
        {error ? <p className="error">{error}</p> : null}

        {bill ? <BillView bill={bill} onDone={() => setBill(null)} /> : null}

        {!bill && order && order.billingMode === "cash_unbilled" ? (
          <div className="card">
            <h2>Cash sale recorded</h2>
            <p className="muted">
              {order.customer} ·{" "}
              {order.lines.map((l) => `${l.blockSerial} × ${l.slabCount}`).join(", ")} ·{" "}
              {formatInr(order.cashAmount)} in cash
            </p>
            <p className="muted">
              Nothing was put on a bill, so there is no tax invoice to raise. The stock
              is out of the yard and the cash is on the books; the GST return lists this
              separately as excluded turnover.
            </p>
            <button type="button" onClick={() => setOrder(null)}>
              Start another sale
            </button>
          </div>
        ) : null}

        {!bill && order && order.billingMode !== "cash_unbilled" ? (
          <div className="card">
            <h2>Invoice this sale</h2>
            <p className="muted">
              {order.customer} ·{" "}
              {order.lines.map((l) => `${l.blockSerial} × ${l.slabCount}`).join(", ")} ·
              billed {formatInr(order.taxableAmount)}
              {order.cashAmount > 0 ? ` · ${formatInr(order.cashAmount)} in cash` : ""}
            </p>
            <p className="muted">
              Ship to, if the goods go somewhere other than the billing address. A
              consignee in another state makes this an IGST supply.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void makeInvoice();
              }}
            >
              <label>
                Invoice date
                <input
                  type="date"
                  max={todayIst()}
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                />
              </label>
              {invoiceDate !== todayIst() ? (
                <p className="hint">
                  This bill will be dated {invoiceDate} and filed in that month&apos;s
                  GST return, not this one.
                </p>
              ) : null}
              <label>
                Consignee name
                <input value={shipName} onChange={(e) => setShipName(e.target.value)} />
              </label>
              <label>
                Consignee address
                <input
                  value={shipAddress}
                  onChange={(e) => setShipAddress(e.target.value)}
                />
              </label>
              <label>
                Consignee GSTIN
                <input value={shipGstin} onChange={(e) => setShipGstin(e.target.value)} />
              </label>
              <label>
                Consignee state code
                <input
                  inputMode="numeric"
                  maxLength={2}
                  placeholder="08"
                  value={shipState}
                  onChange={(e) => setShipState(e.target.value)}
                />
              </label>
              <button type="submit">Raise tax invoice</button>
            </form>
          </div>
        ) : null}

        {!bill && !order ? (
          <>
            <div className="card">
              <h2>Who is buying</h2>
              <label>
                Customer
                <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                  <option value="">Choose a customer</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.gstin ? ` · ${c.gstin}` : " · no GSTIN"}
                    </option>
                  ))}
                </select>
              </label>
              {customers.length === 0 ? (
                <p className="muted">
                  No customers yet. Add one below — the GSTIN decides whether their
                  bill carries CGST + SGST or IGST.
                </p>
              ) : null}
            </div>

            <CustomerForm
              heading="New buyer"
              onAdded={() => {
                void load();
              }}
            />

            <div className="card">
              <h2>Add a lot</h2>
              <form onSubmit={addLine}>
                <label>
                  Block
                  <select
                    value={blockSerial}
                    onChange={(e) => setBlockSerial(e.target.value)}
                  >
                    <option value="">Choose a lot</option>
                    {lots.map((lot) => (
                      <option key={lot.blockId} value={lot.blockSerial}>
                        {lot.blockSerial}-{remaining(lot)} · {lot.variety} ·{" "}
                        {lot.polishedSlabCount} polished
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  How many slabs
                  <input
                    inputMode="numeric"
                    value={slabCount}
                    onChange={(e) => setSlabCount(e.target.value)}
                    placeholder="80"
                  />
                </label>
                <label>
                  Rate per sqft
                  <input
                    inputMode="decimal"
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                    placeholder="85"
                  />
                </label>
                <label>
                  HSN code
                  <select value={hsnCode} onChange={(e) => pickHsn(e.target.value)}>
                    {HSN_CHOICES.map((h) => (
                      <option key={h.code} value={h.code}>
                        {h.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  GST rate
                  <select
                    value={gstRatePct}
                    onChange={(e) => setGstRatePct(e.target.value)}
                  >
                    {RATES.map((r) => (
                      <option key={r} value={r}>
                        {r}%
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Description on the bill
                  <input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="leave blank to use the variety and block"
                  />
                </label>
                <button type="submit">Add to sale</button>
              </form>
              {blockSerial && slabCount ? (
                <p className="hint">
                  {slabCount} ×{" "}
                  {lots.find((l) => l.blockSerial === blockSerial)?.sqftPerSlab ?? 0} sqft
                  ={" "}
                  {Math.round(
                    Number(slabCount) *
                      (lots.find((l) => l.blockSerial === blockSerial)?.sqftPerSlab ?? 0) *
                      100,
                  ) / 100}{" "}
                  sqft
                </p>
              ) : null}
            </div>

            <div className="card wide">
              <h2>This sale</h2>
              {basket.length === 0 ? (
                <EmptyState>
                  Nothing added yet. Pick a block and a slab count above.
                </EmptyState>
              ) : (
                <>
                  <table>
                    <thead>
                      <tr>
                        <th>Block</th>
                        <th className="num">Slabs</th>
                        <th className="num">Sqft</th>
                        <th className="num">Rate</th>
                        <th>HSN</th>
                        <th className="num">GST</th>
                        <th className="num">Amount</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {basket.map((l) => (
                        <tr key={l.key}>
                          <td>
                            <strong>{l.blockSerial}</strong>
                            <span className="muted"> · {l.variety}</span>
                          </td>
                          <td className="num">{l.slabCount}</td>
                          <td className="num">{lineSqft(l)}</td>
                          <td className="num">{formatInr(l.rate)}</td>
                          <td>{l.hsnCode}</td>
                          <td className="num">{l.gstRatePct}%</td>
                          <td className="num">{formatInr(lineAmount(l))}</td>
                          <td>
                            <button
                              type="button"
                              onClick={() =>
                                setBasket((rows) => rows.filter((r) => r.key !== l.key))
                              }
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="hint">
                    Billed {formatInr(basketTaxable)} · GST about{" "}
                    {formatInr(Math.round(basketTax * 100) / 100)} · around{" "}
                    {formatInr(Math.round((basketTaxable + basketTax) * 100) / 100)}.
                    The invoice works out the exact tax per HSN.
                  </p>
                  <label>
                    Taken in cash, no bill (₹)
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="1"
                      value={cashAmount}
                      onChange={(e) => setCashAmount(e.target.value)}
                    />
                  </label>
                  {cash > 0 ? (
                    <>
                      <label>
                        What this cash is for
                        <input
                          value={cashNote}
                          onChange={(e) => setCashNote(e.target.value)}
                          placeholder="optional note"
                        />
                      </label>
                      <p className="hint">
                        Customer pays about{" "}
                        {formatInr(
                          Math.round((basketTaxable + basketTax + cash) * 100) / 100,
                        )}{" "}
                        in all: {formatInr(Math.round((basketTaxable + basketTax) * 100) / 100)}{" "}
                        on the bill and {formatInr(cash)} in cash.
                      </p>
                      <p className="muted">
                        The cash is recorded on its own ledger and shows in the day&apos;s
                        figures. It is left off the tax invoice, so the GST return reports
                        it separately as excluded — the filed turnover is never mistaken
                        for the whole turnover. A supply is taxable whether or not a bill
                        was raised.
                      </p>
                    </>
                  ) : null}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void confirmSale(e);
                    }}
                  >
                    <button
                      type="submit"
                      disabled={!customerId || (basketTaxable <= 0 && cash <= 0)}
                    >
                      Confirm sale and deduct stock
                    </button>
                  </form>
                  {!customerId ? (
                    <p className="muted">Choose a customer first.</p>
                  ) : null}
                  {customerId && basketTaxable <= 0 && cash <= 0 ? (
                    <p className="muted">
                      Put a rate on a line, or a cash amount, or both — otherwise this
                      sale is for nothing.
                    </p>
                  ) : null}
                </>
              )}
            </div>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}

/** The issued bill, as it would be printed. */
function BillView({ bill, onDone }: { bill: Bill; onDone: () => void }) {
  const t = bill.totals;
  return (
    <div className="card wide">
      <h2>Tax invoice {bill.invoiceNumber}</h2>
      <div className="parties">
        <div>
          <h3>Seller</h3>
          <p>
            <strong>{bill.seller.legalName ?? "—"}</strong>
            <br />
            GSTIN {bill.seller.gstin ?? "not registered"}
            <br />
            State {bill.seller.stateCode ?? "—"}
          </p>
        </div>
        <div>
          <h3>Bill to</h3>
          <p>
            <strong>{bill.billTo.name}</strong>
            <br />
            {bill.billTo.address ?? "no address on file"}
            <br />
            GSTIN {bill.billTo.gstin ?? "—"}
          </p>
        </div>
        <div>
          <h3>Ship to</h3>
          <p>
            <strong>{bill.shipTo.name ?? bill.billTo.name}</strong>
            <br />
            {bill.shipTo.address ?? "same as billing"}
            <br />
            GSTIN {bill.shipTo.gstin ?? "—"}
          </p>
        </div>
      </div>
      <p className="muted">
        Place of supply {bill.placeOfSupply ?? "—"} ·{" "}
        {bill.interState ? "inter-state (IGST)" : "within the state (CGST + SGST)"}
      </p>

      <table>
        <thead>
          <tr>
            <th>Description</th>
            <th>HSN</th>
            <th className="num">Slabs</th>
            <th className="num">Sqft</th>
            <th className="num">Rate</th>
            <th className="num">GST</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {bill.items.map((item, index) => (
            <tr key={index}>
              <td>
                {item.description ?? "—"}
                {item.blockSerial ? (
                  <span className="muted"> · {item.blockSerial}</span>
                ) : null}
              </td>
              <td>{item.hsnCode ?? "—"}</td>
              <td className="num">{item.slabCount ?? "—"}</td>
              <td className="num">{item.quantitySqft}</td>
              <td className="num">{formatInr(item.rate)}</td>
              <td className="num">{item.gstRatePct}%</td>
              <td className="num">{formatInr(item.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>HSN summary</h3>
      <table>
        <thead>
          <tr>
            <th>HSN</th>
            <th className="num">Rate</th>
            <th className="num">Taxable</th>
            <th className="num">CGST</th>
            <th className="num">SGST</th>
            <th className="num">IGST</th>
          </tr>
        </thead>
        <tbody>
          {bill.hsnSummary.map((row) => (
            <tr key={`${row.hsnCode}-${row.gstRatePct}`}>
              <td>{row.hsnCode}</td>
              <td className="num">{row.gstRatePct}%</td>
              <td className="num">{formatInr(row.taxableAmount)}</td>
              <td className="num">{formatInr(row.cgstAmount)}</td>
              <td className="num">{formatInr(row.sgstAmount)}</td>
              <td className="num">{formatInr(row.igstAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="grid">
        <div className="metric">
          <span>Taxable</span>
            <b>{formatInr(t.taxableAmount)}</b>
        </div>
        <div className="metric">
          <span>CGST</span>
            <b>{formatInr(t.cgstAmount)}</b>
        </div>
        <div className="metric">
          <span>SGST</span>
            <b>{formatInr(t.sgstAmount)}</b>
        </div>
        <div className="metric">
          <span>IGST</span>
            <b>{formatInr(t.igstAmount)}</b>
        </div>
        <div className="metric">
          <span>Payable</span>
            <b>{formatInr(t.payable)}</b>
        </div>
      </div>

      <button type="button" onClick={() => window.print()}>
        Print
      </button>{" "}
      <button type="button" onClick={onDone}>
        Start another sale
      </button>
    </div>
  );
}
