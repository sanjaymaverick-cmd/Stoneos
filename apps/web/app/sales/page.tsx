"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { Attachments } from "../../components/Attachments";
import { VarietyChips } from "../../components/VarietyChips";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { apiFetch, isQueued, pendingRef, ref } from "../../lib/api";
import { bodyOf, queuedAt, useOutbox } from "../../lib/useOutbox";
import { slabLabel, slabSqft } from "../../lib/format";

type Customer = { id: string; name: string };
type Slab = {
  id: string;
  slabSerial: string;
  salesStatus: string;
  varietyName?: string | null;
  lengthFt?: string | null;
  widthFt?: string | null;
  thicknessMm?: number | null;
  location?: { code: string } | null;
};

/** Only polished stock nobody has reserved can go on an order. */
const sellable = (slab: Slab) =>
  slab.salesStatus === "in_stock" && slab.location?.code !== "UNPOLISHED_STOCK";
type Order = {
  id: string;
  status: string;
  customer: { name: string };
  lines: Array<{
    slabId: string | null;
    slab?: { salesStatus: string; location?: { code: string } | null } | null;
  }>;
  invoices: Array<{
    id: string;
    amount: string;
    invoiceNumber?: string;
    payments?: Array<{ amount: string }>;
    creditNotes?: Array<{ amount: string }>;
  }>;
  packingLists?: Array<{ id: string }>;
};
type Dropped = {
  droppedSlabs?: Array<{ slabSerial: string }>;
  skippedSlabs?: string[];
};

/** An order the server has, or one taken on this phone that has not synced. */
type OrderRow = {
  key: string;
  /** Server id, or a reference to the queued order for writes that follow it. */
  target: string;
  customerName: string;
  status: string;
  slabIds: string[];
  returnSlabIds?: string[];
  packed?: boolean;
  pending?: string;
  invoice?: { id: string; amount: string; invoiceNumber?: string };
};

export default function SalesPage() {
  const [search, setSearch] = useState("");
  const [variety, setVariety] = useState("");
  const [canCollect, setCanCollect] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [slabs, setSlabs] = useState<Slab[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [name, setName] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [slabId, setSlabId] = useState("");
  const [qty, setQty] = useState("32");
  const [rate, setRate] = useState("120");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const { items, refresh: refreshQueue } = useOutbox();
  const opIds = useRef<Record<string, string>>({});
  function stableOp(key: string) {
    opIds.current[key] ??= crypto.randomUUID();
    return opIds.current[key];
  }
  function clearOp(key: string) {
    delete opIds.current[key];
  }

  /** Choosing a slab fills in its face area, so sqft is never typed from memory. */
  function pickSlab(slab: Slab) {
    setSlabId(slab.id);
    const sqft = slabSqft(slab);
    if (sqft) setQty(String(sqft));
  }

  async function refresh() {
    const [c, s, o] = await Promise.all([
      apiFetch<Customer[]>("/api/v1/customers"),
      apiFetch<Slab[]>("/api/v1/inventory/slabs"),
      apiFetch<Order[]>("/api/v1/sales-orders"),
    ]);
    apiFetch<{ role: string }>("/api/v1/auth/me")
      .then((u) => setCanCollect(u.role === "owner"))
      .catch(() => undefined);
    setCustomers(c);
    setSlabs(s);
    setOrders(o);
    if (!customerId && c[0]) setCustomerId(c[0].id);
    const available = s.find(sellable);
    if (!slabId && available) pickSlab(available);
  }
  useEffect(() => {
    refresh().catch(() => undefined);
  }, []);

  async function run(action: () => Promise<void>) {
    try {
      setError("");
      await action();
    } catch (err) {
      setNotice("");
      setError(err instanceof Error ? err.message : "Could not save");
    }
    await Promise.all([refresh().catch(() => undefined), refreshQueue()]);
  }

  /** Say what happened in words a salesman can act on. */
  function report(result: unknown, done: string) {
    if (isQueued(result)) {
      setNotice(
        `${done} — saved on this phone and will get its real number when the phone is back online.`,
      );
      return;
    }
    const left =
      (result as Dropped)?.droppedSlabs?.map((d) => d.slabSerial) ?? [];
    setNotice(
      left.length
        ? `${done}. Already sold to someone else, so left out: ${left.join(", ")}.`
        : `${done}.`,
    );
  }

  const customerName = (id: string) =>
    customers.find((c) => c.id === id)?.name ?? "Customer";
  const queuedOrders = queuedAt(items, "/api/v1/sales-orders");
  const queuedSteps = (target: string) =>
    items
      .filter((i) => i.path.startsWith(`/api/v1/sales-orders/${target}/`))
      .map((i) => i.path.split("/").pop());

  const rows: OrderRow[] = [
    ...queuedOrders.map((q) => {
      const body = bodyOf<{
        customerId: string;
        lines: Array<{ slabId?: string }>;
      }>(q);
      return {
        key: q.clientOpId,
        target: ref(q.clientOpId),
        customerName: customerName(body.customerId),
        status: "CONFIRMED",
        slabIds: body.lines
          .map((l) => l.slabId)
          .filter((id): id is string => Boolean(id)),
        pending: pendingRef(q.clientOpId),
      };
    }),
    ...orders.map((o) => ({
      key: o.id,
      target: o.id,
      customerName: o.customer.name,
      status: o.status,
      slabIds: o.lines
        .filter((l) => l.slab?.salesStatus !== "dispatched")
        .map((l) => l.slabId)
        .filter((id): id is string => Boolean(id)),
      returnSlabIds: o.lines
        .filter((l) => l.slab?.salesStatus === "dispatched")
        .map((l) => l.slabId)
        .filter((id): id is string => Boolean(id)),
      packed: o.lines.some(
        (l) => l.slabId && l.slab?.salesStatus !== "dispatched",
      )
        ? o.lines
            .filter((l) => l.slabId && l.slab?.salesStatus !== "dispatched")
            .every((l) => l.slab?.location?.code === "PACKING")
        : Boolean(o.packingLists?.length),
      invoice: o.invoices[0]
        ? {
            ...o.invoices[0],
            amount: String(
              Math.max(
                0,
                Number(o.invoices[0].amount) -
                  (o.invoices[0].payments ?? []).reduce(
                    (n, p) => n + Number(p.amount),
                    0,
                  ) -
                  (o.invoices[0].creditNotes ?? []).reduce(
                    (n, c) => n + Number(c.amount),
                    0,
                  ),
              ),
            ),
          }
        : undefined,
    })),
  ];

  async function addCustomer(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await apiFetch("/api/v1/customers", {
        method: "POST",
        label: `New customer ${name}`,
        body: JSON.stringify({ name }),
      });
      setName("");
    });
  }

  async function createOrder(event: FormEvent) {
    event.preventDefault();
    const who = customerName(customerId);
    await run(async () => {
      const result = await apiFetch("/api/v1/sales-orders", {
        method: "POST",
        label: `Order · ${who}`,
        body: JSON.stringify({
          customerId,
          orderDate: new Date().toISOString().slice(0, 10),
          clientOpId: stableOp("order"),
          // First to the server wins a slab; keep the rest of the order if one is gone.
          partial: true,
          lines: [
            {
              slabId: slabId || undefined,
              quantitySqft: Number(qty),
              rate: Number(rate),
            },
          ],
        }),
      });
      clearOp("order");
      report(result, `Order for ${who} confirmed`);
    });
  }

  const step = (
    row: OrderRow,
    path: string,
    label: string,
    body: Record<string, unknown>,
    done: string,
    opKey?: string,
  ) =>
    run(async () => {
      const result = await apiFetch(
        `/api/v1/sales-orders/${row.target}/${path}`,
        {
          method: "POST",
          label: `${label} · ${row.customerName}${row.pending ? ` (${row.pending})` : ""}`,
          body: JSON.stringify({
            ...body,
            ...(opKey ? { clientOpId: stableOp(opKey) } : {}),
          }),
        },
      );
      if (opKey) clearOp(opKey);
      report(result, done);
    });

  return (
    <AppShell>
      <h1>Sell</h1>
      <p>
        <Link href="/lots/sell">Sell by lot — pick blocks and slab counts, bill them together →</Link>
      </p>
      {notice ? (
        <p className="muted" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="card">
        <form onSubmit={addCustomer}>
          <label>
            Customer name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
          <button type="submit">Add customer</button>
        </form>
      </div>
      <div className="card">
        <h2>Reserve / order</h2>
        <form onSubmit={createOrder}>
          <label>
            Customer
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              {customers.length === 0 ? (
                <option value="">No customers yet</option>
              ) : null}
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Search slabs
            <input value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <VarietyChips value={variety} onChange={setVariety} />
          <label>
            Slab
            <select
              value={slabId}
              onChange={(e) => {
                const picked = slabs.find((s) => s.id === e.target.value);
                if (picked) pickSlab(picked);
                else setSlabId("");
              }}
            >
              <option value="">No specific slab (lot sale)</option>
              {slabs
                .filter(
                  (s) =>
                    sellable(s) &&
                    (!variety || s.varietyName === variety) &&
                    slabLabel(s).toLowerCase().includes(search.toLowerCase()),
                )
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {slabLabel(s)}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Sqft
            <input
              inputMode="decimal"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </label>
          <label>
            Rate
            <input
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
          </label>
          <button type="submit">Confirm order</button>
        </form>
      </div>
      <div className="card">
        <h2>Orders</h2>
        {rows.length === 0 ? (
          <EmptyState>
            No sales orders yet. Add a customer and confirm an order to populate
            this list.
          </EmptyState>
        ) : null}
        {rows.map((row) => {
          const waiting = queuedSteps(row.target);
          return (
            <div className="card" key={row.key}>
              {row.customerName} — {row.status}
              {row.pending ? (
                <span className="pending-tag">not synced</span>
              ) : null}
              {row.invoice?.invoiceNumber ? (
                <span className="muted"> · {row.invoice.invoiceNumber}</span>
              ) : null}
              {waiting.length ? (
                <span className="muted"> · queued: {waiting.join(", ")}</span>
              ) : null}{" "}
              {["CONFIRMED", "PARTIALLY_DELIVERED"].includes(row.status) &&
                !row.packed &&
                !waiting.includes("packing") && (
                  <button
                    type="button"
                    onClick={() =>
                      step(
                        row,
                        "packing",
                        "Pack",
                        {
                          slabIds: row.slabIds,
                          partial: row.slabIds.length > 0,
                        },
                        "Packed",
                      )
                    }
                  >
                    Pack
                  </button>
                )}
              {["CONFIRMED", "PARTIALLY_DELIVERED"].includes(row.status) &&
                (row.packed || waiting.includes("packing")) &&
                !waiting.includes("dispatch") && (
                  <button
                    type="button"
                    onClick={() =>
                      step(
                        row,
                        "dispatch",
                        "Dispatch",
                        {
                          slabIds: row.slabIds,
                          partial: row.slabIds.length > 0,
                        },
                        "Dispatched",
                        `disp:${row.key}`,
                      )
                    }
                  >
                    Dispatch
                  </button>
                )}
              {canCollect &&
                row.status === "DELIVERED" &&
                !row.invoice &&
                !waiting.includes("invoice") && (
                  <button
                    type="button"
                    onClick={() =>
                      step(
                        row,
                        "invoice",
                        "Invoice",
                        {},
                        "Invoice raised",
                        `inv:${row.key}`,
                      )
                    }
                  >
                    Invoice
                  </button>
                )}
              {canCollect && row.invoice && Number(row.invoice.amount) > 0 ? (
                <button
                  type="button"
                  onClick={() =>
                    run(async () => {
                      const invoice = row.invoice!;
                      const result = await apiFetch(
                        `/api/v1/invoices/${invoice.id}/payments`,
                        {
                          method: "POST",
                          label: `Payment ${invoice.invoiceNumber ?? ""} · ${row.customerName}`,
                          body: JSON.stringify({
                            amount: Number(invoice.amount),
                            method: "cash",
                            paidAt: new Date().toISOString().slice(0, 10),
                            clientOpId: stableOp(`pay:${invoice.id}`),
                          }),
                        },
                      );
                      clearOp(`pay:${invoice.id}`);
                      report(result, "Payment recorded");
                    })
                  }
                >
                  Record payment
                </button>
              ) : row.pending ? (
                <span className="muted">
                  {" "}
                  · payment after the invoice syncs
                </span>
              ) : null}
              {!row.pending &&
              (row.invoice ||
                ["DELIVERED", "PARTIALLY_DELIVERED"].includes(row.status)) ? (
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    step(
                      row,
                      "returns",
                      "Return",
                      {
                        slabIds: row.returnSlabIds ?? [],
                        reason: "customer return",
                      },
                      "Return recorded",
                    )
                  }
                >
                  Return
                </button>
              ) : null}
              {!row.pending && <Attachments type="order" id={row.target} />}
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}
