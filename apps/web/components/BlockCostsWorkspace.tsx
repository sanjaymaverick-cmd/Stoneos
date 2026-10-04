"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { apiFetch } from "../lib/api";
import { formatInr, todayIst } from "../lib/format";
type Block = {
  id: string;
  serial: string;
  variety: string;
  supplier: string;
  weightTons: number;
  stoneCost: number | null;
  blockPricePerTon: number | null;
  royaltyPerTon: number | null;
  transportPerTon: number | null;
  royaltyExpected: number | null;
  transportExpected: number | null;
  pendingPerTonCost: number;
  totalRecordedCost: number | null;
  estimatedLandedCost: number | null;
  costStatus: string;
};
type Allocation = {
  rawBlockId: string;
  allocatedAmount: string | number;
  costComponent: string;
};
type Expense = {
  id: string;
  category: string;
  amount: string | number;
  taxableAmount: string | number | null;
  expenseDate: string;
  toWhom: string | null;
  allocations: Allocation[];
};
type Review = {
  block: Block;
  kind: "new" | "existing";
  expense?: Expense;
  amount: number;
  category: string;
  component: "other" | "royalty" | "block_transport";
  date: string;
  payee: string;
  paymentMethod: "cash" | "bank" | "upi";
  gstRatePct: number;
  supplierGstin?: string;
  paidAmount: number;
  op: string;
};
const money = (v: number | null) =>
  v === null ? "Not recorded" : formatInr(v);
const remaining = (e: Expense) =>
  Math.max(
    0,
    Math.round(Number(e.taxableAmount ?? e.amount) * 100) -
      e.allocations.reduce(
        (n, a) => n + Math.round(Number(a.allocatedAmount) * 100),
        0,
      ),
  ) / 100;
const componentName = (s: string) =>
  s === "royalty"
    ? "Block royalty"
    : s === "block_transport"
      ? "Block transport rent"
      : "Other block cost";
export function BlockCostsWorkspace({
  initialBlockId,
}: {
  initialBlockId?: string;
}) {
  const [blocks, setBlocks] = useState<Block[]>([]),
    [expenses, setExpenses] = useState<Expense[]>([]),
    [blockId, setBlockId] = useState(""),
    [kind, setKind] = useState<"new" | "existing">("new"),
    [expenseId, setExpenseId] = useState("");
  const [component, setComponent] = useState<Review["component"]>("other"),
    [amount, setAmount] = useState(""),
    [category, setCategory] = useState("other"),
    [date, setDate] = useState(todayIst()),
    [payee, setPayee] = useState("");
  const [suppliers, setSuppliers] = useState<
      Array<{ id: string; name: string; gstin: string | null }>
    >([]),
    [supplierId, setSupplierId] = useState(""),
    [gstRatePct, setGstRatePct] = useState(0);
  const [paymentMethod, setPaymentMethod] =
    useState<Review["paymentMethod"]>("cash");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [online, setOnline] = useState(true),
    [review, setReview] = useState<Review | null>(null),
    [retryRequired, setRetryRequired] = useState(false);
  const refresh = async () => {
    const [snapshot, rows, vendors] = await Promise.all([
      apiFetch<{ blockCosts: Block[] }>("/api/v1/reports/analytics"),
      apiFetch<Expense[]>("/api/v1/expenses"),
      apiFetch<Array<{ id: string; name: string; gstin: string | null }>>(
        "/api/v1/inventory/suppliers",
      ),
    ]);
    setBlocks(snapshot.blockCosts);
    setExpenses(rows);
    setSuppliers(vendors);
  };
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    setBlockId(initialBlockId ?? q.get("block") ?? "");
    if (q.get("expense")) {
      setKind("existing");
      setExpenseId(q.get("expense")!);
    }
    const network = () => setOnline(navigator.onLine);
    network();
    window.addEventListener("online", network);
    window.addEventListener("offline", network);
    refresh()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    return () => {
      window.removeEventListener("online", network);
      window.removeEventListener("offline", network);
    };
  }, []);
  const selected = blocks.find((b) => b.id === blockId),
    expense = expenses.find((e) => e.id === expenseId),
    available = expenses.filter((e) => remaining(e) > 0);
  const allocatedHere = expenses.flatMap((e) =>
    e.allocations
      .filter((a) => a.rawBlockId === blockId)
      .map((a) => ({ expense: e, allocation: a })),
  );
  const reset = () => {
    setReview(null);
    setRetryRequired(false);
    setAmount("");
    setExpenseId("");
    setPayee("");
    setSupplierId("");
    setGstRatePct(0);
  };
  const prepare = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setNotice("");
    if (!selected) return;
    const value = Number(amount);
    if (
      !Number.isFinite(value) ||
      value <= 0 ||
      Math.round(value * 100) / 100 !== value
    ) {
      setError("Enter a positive amount with at most two decimals.");
      return;
    }
    if (kind === "existing" && (!expense || value > remaining(expense))) {
      setError(
        "Choose an expense and stay within its unallocated amount before GST.",
      );
      return;
    }
    const vendor = suppliers.find((s) => s.id === supplierId);
    if (kind === "new" && gstRatePct > 0 && !vendor?.gstin) {
      setError("Select a supplier with a GSTIN for charged GST.");
      return;
    }
    setReview({
      block: selected,
      kind,
      expense,
      amount: value,
      gstRatePct,
      paymentMethod,
      supplierGstin: vendor?.gstin ?? undefined,
      paidAmount:
        (Math.round(value * 100) + Math.round(value * gstRatePct)) / 100,
      category,
      component,
      date,
      payee,
      op: crypto.randomUUID(),
    });
  };
  const save = async () => {
    if (!review || busy || !online) return;
    setBusy(true);
    setError("");
    try {
      if (review.kind === "new")
        await apiFetch("/api/v1/expenses", {
          method: "POST",
          onlineOnly: true,
          body: JSON.stringify({
            category: review.category,
            amount: review.paidAmount,
            taxableAmount: review.amount,
            gstRatePct: review.gstRatePct,
            paymentMethod: review.paymentMethod,
            supplierGstin: review.supplierGstin,
            expenseDate: review.date,
            toWhom: review.payee.trim(),
            clientOpId: review.op,
            blockCost: {
              rawBlockId: review.block.id,
              costComponent: review.component,
            },
          }),
        });
      else
        await apiFetch("/api/v1/expenses/" + review.expense!.id + "/allocate", {
          method: "POST",
          onlineOnly: true,
          body: JSON.stringify({
            clientOpId: review.op,
            batchKey: review.op,
            allocations: [
              {
                rawBlockId: review.block.id,
                allocatedAmount: review.amount,
                costComponent: review.component,
              },
            ],
          }),
        });
      setNotice(
        review.kind === "new"
          ? "Expense recorded and linked to " + review.block.serial + "."
          : "Existing expense linked to " +
              review.block.serial +
              "; no second payment was recorded.",
      );
      reset();
      try {
        await refresh();
      } catch {
        setError(
          "Saved successfully. Reconnect and refresh to view the updated totals.",
        );
      }
    } catch (e) {
      const failure = e as { message?: string; status?: number };
      setError(failure.message ?? "Unable to save");
      setRetryRequired(!failure.status || failure.status >= 500);
    } finally {
      setBusy(false);
    }
  };
  if (loading)
    return (
      <section className="card">
        <p>Loading block costs…</p>
      </section>
    );
  return (
    <div className="block-cost-workspace">
      <section className="card">
        <div className="cost-heading">
          <div>
            <h2>Block costs</h2>
            <p>
              Receive, cost and review a block in Yard. The same expenses appear
              in Money.
            </p>
          </div>
          <div>
            <Link href="/expenses">View expense register →</Link>
            <button
              type="button"
              className="secondary"
              disabled={busy || !!review}
              onClick={() => {
                setError("");
                refresh().catch((e) => setError(e.message));
              }}
            >
              Refresh costs
            </button>
          </div>
        </div>
        <label>
          Select block
          <select
            value={blockId}
            disabled={!!review || busy}
            onChange={(e) => {
              setBlockId(e.target.value);
              setNotice("");
              setError("");
            }}
          >
            <option value="">Choose a block</option>
            {blocks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.serial} · {b.variety} · {b.weightTons} t · {b.supplier}
              </option>
            ))}
          </select>
        </label>
      </section>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="cost-success">
          {notice}
        </p>
      )}
      {!online && (
        <p role="status" className="error">
          Connect to review current balances and save block costs.
        </p>
      )}
      {!selected ? (
        <section className="card">
          <p>
            {blocks.length
              ? "Choose the block first. Its costs and linked expenses will appear here."
              : "Receive a raw block first, then record its costs here."}
          </p>
        </section>
      ) : (
        <>
          <section className="card cost-context">
            <h2>
              {selected.serial}{" "}
              <span className="muted">· {selected.variety}</span>
            </h2>
            <p>
              {selected.supplier} · {selected.weightTons} tons ·{" "}
              {selected.costStatus}
            </p>
            <div className="cost-summary-grid">
              {[
                ["Stone purchase", selected.stoneCost],
                [
                  selected.royaltyPerTon === null
                    ? "Royalty · rate not recorded"
                    : "Royalty · " + money(selected.royaltyPerTon) + "/ton",
                  selected.royaltyExpected,
                ],
                [
                  selected.transportPerTon === null
                    ? "Transport · rate not recorded"
                    : "Transport · " + money(selected.transportPerTon) + "/ton",
                  selected.transportExpected,
                ],
                ["Total recorded cost", selected.totalRecordedCost],
              ].map(([label, value]) => (
                <div className="metric" key={String(label)}>
                  <span>{String(label)}</span>
                  <b>{money(value as number | null)}</b>
                </div>
              ))}
            </div>
            <p>
              Estimated landed cost:{" "}
              <strong>{money(selected.estimatedLandedCost)}</strong> · Royalty /
              transport still to record:{" "}
              <strong>{formatInr(selected.pendingPerTonCost)}</strong>
            </p>
            <p className="muted">
              Stone purchase already includes the billed and cash amounts. Do
              not record it again as an expense. Royalty and transport rates are
              estimates until linked expenses cover them.
            </p>
            <details>
              <summary>Review per-ton rates</summary>
              <form
                key={selected.id}
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  setError("");
                  setBusy(true);
                  try {
                    await apiFetch(
                      "/api/v1/reports/analytics/blocks/" +
                        selected.id +
                        "/rates",
                      {
                        method: "POST",
                        onlineOnly: true,
                        body: JSON.stringify(
                          Object.fromEntries(
                            [
                              "blockPricePerTon",
                              "royaltyPerTon",
                              "transportPerTon",
                            ].map((k) => [
                              k,
                              f.get(k) === "" ? null : Number(f.get(k)),
                            ]),
                          ),
                        ),
                      },
                    );
                    await refresh();
                    setNotice("Per-ton rates updated.");
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {[
                  [
                    "blockPricePerTon",
                    "Block price",
                    selected.blockPricePerTon,
                  ],
                  ["royaltyPerTon", "Block royalty", selected.royaltyPerTon],
                  [
                    "transportPerTon",
                    "Transport rent",
                    selected.transportPerTon,
                  ],
                ].map(([key, label, value]) => (
                  <label key={String(key)}>
                    {String(label)} (₹/ton)
                    <input
                      type="number"
                      name={String(key)}
                      min="0"
                      step="0.01"
                      defaultValue={value ?? ""}
                      disabled={!!review || busy}
                    />
                  </label>
                ))}
                <button disabled={busy || !!review || !online}>
                  Save rates
                </button>
              </form>
            </details>
          </section>
          {review ? (
            <section
              className="card cost-review"
              aria-label="Review block expense"
            >
              <h2>Review before saving</h2>
              <dl>
                <dt>Block</dt>
                <dd>
                  <strong>{review.block.serial}</strong> ·{" "}
                  {review.block.variety} · {review.block.weightTons} t
                </dd>
                <dt>Action</dt>
                <dd>
                  {review.kind === "new"
                    ? "Record a new paid expense and link it to this block"
                    : "Link an expense already recorded in Money"}
                </dd>
                <dt>Cost</dt>
                <dd>{componentName(review.component)}</dd>
                <dt>Paid to / date</dt>
                <dd>
                  {review.kind === "new"
                    ? review.payee
                    : review.expense?.toWhom}{" "}
                  ·{" "}
                  {review.kind === "new"
                    ? review.date
                    : review.expense?.expenseDate.slice(0, 10)}
                </dd>
                {review.kind === "new" && (
                  <>
                    <dt>Expense category / supplier GSTIN</dt>
                    <dd>
                      {review.category} ·{" "}
                      {review.supplierGstin ?? "No GST charged"}
                    </dd>
                    <dt>Paid total including GST / mode</dt>
                    <dd>
                      {formatInr(review.paidAmount)} · {review.paymentMethod} ·{" "}
                      {review.gstRatePct}% GST
                    </dd>
                  </>
                )}
                <dt>Amount linked before GST</dt>
                <dd>
                  <strong>{formatInr(review.amount)}</strong>
                </dd>
                {review.expense && (
                  <>
                    <dt>Expense total / unallocated</dt>
                    <dd>
                      {formatInr(Number(review.expense.amount))} /{" "}
                      {formatInr(remaining(review.expense))}
                    </dd>
                  </>
                )}
              </dl>
              <p>
                {review.kind === "new"
                  ? "This records one expense and one financial posting, and links its full cost to this block in the same save."
                  : "This changes the block cost allocation only. The original expense and payment remain as recorded."}
              </p>
              <div className="cost-actions">
                <button disabled={busy || !online} onClick={save}>
                  {busy
                    ? "Saving…"
                    : retryRequired
                      ? "Retry same save"
                      : review.kind === "new"
                        ? "Confirm expense & block"
                        : "Confirm link"}
                </button>
                <button
                  className="secondary"
                  disabled={busy || retryRequired}
                  onClick={() => setReview(null)}
                >
                  Back to edit
                </button>
              </div>
              {retryRequired && (
                <p>
                  The response was interrupted. Retry this same save so its
                  reference is reused and it cannot record a second expense.
                </p>
              )}
            </section>
          ) : (
            <section className="card">
              <h2>Add a cost to {selected.serial}</h2>
              <div className="cost-actions">
                <button
                  type="button"
                  aria-pressed={kind === "new"}
                  className={kind === "new" ? "" : "secondary"}
                  onClick={() => {
                    setKind("new");
                    setAmount("");
                  }}
                >
                  Record new expense
                </button>
                <button
                  type="button"
                  aria-pressed={kind === "existing"}
                  className={kind === "existing" ? "" : "secondary"}
                  onClick={() => {
                    setKind("existing");
                    setAmount("");
                  }}
                >
                  Link existing expense
                </button>
              </div>
              <form onSubmit={prepare}>
                {kind === "existing" ? (
                  <>
                    <label>
                      Expense from Money
                      <select
                        value={expenseId}
                        required
                        onChange={(e) => {
                          setExpenseId(e.target.value);
                          setAmount("");
                        }}
                      >
                        <option value="">Choose an unallocated expense</option>
                        {available.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.expenseDate.slice(0, 10)} ·{" "}
                            {e.toWhom ?? e.category} · {formatInr(remaining(e))}{" "}
                            remaining
                          </option>
                        ))}
                      </select>
                    </label>
                    {expense && (
                      <div className="cost-expense-context">
                        <p>
                          <strong>{expense.toWhom ?? expense.category}</strong>{" "}
                          · {expense.expenseDate.slice(0, 10)} ·{" "}
                          {expense.category}
                        </p>
                        <p>
                          Total paid: {formatInr(Number(expense.amount))} ·
                          Before GST:{" "}
                          {formatInr(
                            Number(expense.taxableAmount ?? expense.amount),
                          )}{" "}
                          · Available to link:{" "}
                          <strong>{formatInr(remaining(expense))}</strong>
                        </p>
                        {expense.allocations.length > 0 && (
                          <p>
                            Already linked:{" "}
                            {expense.allocations
                              .map(
                                (a) =>
                                  (blocks.find((b) => b.id === a.rawBlockId)
                                    ?.serial ?? "Block") +
                                  " " +
                                  formatInr(Number(a.allocatedAmount)),
                              )
                              .join(" · ")}
                          </p>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <label>
                      Expense date
                      <input
                        type="date"
                        value={date}
                        max={todayIst()}
                        required
                        onChange={(e) => setDate(e.target.value)}
                      />
                    </label>
                    <label>
                      Paid to
                      <input
                        value={payee}
                        required
                        maxLength={200}
                        onChange={(e) => setPayee(e.target.value)}
                        placeholder="Supplier, transporter or person"
                      />
                    </label>
                  </>
                )}
                <label>
                  Cost component
                  <select
                    value={component}
                    onChange={(e) => {
                      setComponent(e.target.value as Review["component"]);
                      setCategory(
                        e.target.value === "block_transport"
                          ? "transport"
                          : "other",
                      );
                    }}
                  >
                    <option value="other">Other block cost</option>
                    <option value="royalty">Block royalty</option>
                    <option value="block_transport">
                      Block transport rent
                    </option>
                  </select>
                </label>
                {kind === "new" && (
                  <label>
                    Expense category
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                    >
                      <option value="other">Other / royalty</option>
                      <option value="transport">Transport</option>
                      <option value="electricity">Electricity / cutting</option>
                      <option value="consumables">
                        Consumables / polishing
                      </option>
                      <option value="diesel">Diesel</option>
                      <option value="wages">Wages</option>
                      <option value="maintenance">Maintenance</option>
                    </select>
                  </label>
                )}
                {kind === "new" && (
                  <>
                    <label>
                      GST supplier / transporter
                      <select
                        value={supplierId}
                        onChange={(e) => {
                          setSupplierId(e.target.value);
                          const vendor = suppliers.find(
                            (s) => s.id === e.target.value,
                          );
                          if (vendor) setPayee(vendor.name);
                        }}
                      >
                        <option value="">No supplier GST charged</option>
                        {suppliers.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name} · {v.gstin ?? "unregistered"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Payment mode
                      <select
                        value={paymentMethod}
                        onChange={(e) =>
                          setPaymentMethod(
                            e.target.value as Review["paymentMethod"],
                          )
                        }
                      >
                        <option value="cash">Cash</option>
                        <option value="bank">Bank</option>
                        <option value="upi">UPI</option>
                      </select>
                    </label>
                    <label>
                      GST charged on this bill
                      <select
                        value={gstRatePct}
                        onChange={(e) => setGstRatePct(Number(e.target.value))}
                      >
                        {[0, 0.25, 3, 5, 12, 18, 28].map((r) => (
                          <option key={r} value={r}>
                            {r}%
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
                <label>
                  {kind === "new"
                    ? "Expense cost before GST (₹)"
                    : "Amount to link before GST (₹)"}
                  <input
                    type="number"
                    min="0.01"
                    max={
                      kind === "existing" && expense
                        ? remaining(expense)
                        : undefined
                    }
                    step="0.01"
                    value={amount}
                    required
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
                <p className="muted">
                  {kind === "new"
                    ? "The cost before GST is linked to the block. Charged GST goes to input GST, with a matching supplier GSTIN and your GST profile. Zero records a payment without charged GST."
                    : "Only the remaining cost before GST can be linked. Fully allocated expenses are excluded."}
                </p>
                <button disabled={busy || !online}>
                  Review expense & block
                </button>
              </form>
            </section>
          )}
          <section className="card">
            <h2>Linked expenses · {selected.serial}</h2>
            {allocatedHere.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date / paid to</th>
                      <th>Cost component</th>
                      <th>Linked before GST</th>
                      <th>Expense</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allocatedHere.map(({ expense: e, allocation: a }, i) => (
                      <tr key={e.id + ":" + i}>
                        <td>
                          {e.expenseDate.slice(0, 10)}
                          <br />
                          {e.toWhom ?? e.category}
                        </td>
                        <td>{componentName(a.costComponent)}</td>
                        <td>{formatInr(Number(a.allocatedAmount))}</td>
                        <td>
                          <Link href={"/expenses#expense-" + e.id}>
                            View in Money →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>No expenses linked to this block yet.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
