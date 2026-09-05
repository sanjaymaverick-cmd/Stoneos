"use client";

import { FormEvent, useEffect, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { apiFetch } from "../../lib/api";

type Customer = { id: string; name: string };
type Slab = { id: string; slabSerial: string; salesStatus: string };
type Order = {
  id: string;
  status: string;
  customer: { name: string };
  lines: Array<{ slabId: string | null }>;
  invoices: Array<{ id: string; amount: string }>;
};

export default function SalesPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [slabs, setSlabs] = useState<Slab[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [name, setName] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [slabId, setSlabId] = useState("");
  const [qty, setQty] = useState("32");
  const [rate, setRate] = useState("120");

  async function refresh() {
    const [c, s, o] = await Promise.all([
      apiFetch<Customer[]>("/api/v1/customers"),
      apiFetch<Slab[]>("/api/v1/inventory/slabs"),
      apiFetch<Order[]>("/api/v1/sales-orders"),
    ]);
    setCustomers(c);
    setSlabs(s);
    setOrders(o);
    if (!customerId && c[0]) setCustomerId(c[0].id);
    const available = s.find((row) => row.salesStatus === "in_stock");
    if (!slabId && available) setSlabId(available.id);
  }
  useEffect(() => { refresh().catch(() => undefined); }, []);

  async function addCustomer(event: FormEvent) {
    event.preventDefault();
    await apiFetch("/api/v1/customers", { method: "POST", body: JSON.stringify({ name }) });
    setName("");
    await refresh();
  }

  async function createOrder(event: FormEvent) {
    event.preventDefault();
    await apiFetch("/api/v1/sales-orders", {
      method: "POST",
      body: JSON.stringify({
        customerId,
        orderDate: new Date().toISOString().slice(0, 10),
        clientOpId: crypto.randomUUID(),
        lines: [{ slabId: slabId || undefined, quantitySqft: Number(qty), rate: Number(rate) }],
      }),
    });
    await refresh();
  }

  return (
    <AppShell>
      <h1>Sales</h1>
      <div className="card">
        <form onSubmit={addCustomer}>
          <label>Customer name<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
          <button type="submit">Add customer</button>
        </form>
      </div>
      <div className="card">
        <h2>Quotation</h2>
        <button type="button" onClick={() => apiFetch("/api/v1/quotations", {
          method: "POST",
          body: JSON.stringify({
            customerId,
            lines: [{ description: "Polished slab lot", quantitySqft: Number(qty), rate: Number(rate), slabId: slabId || undefined }],
          }),
        }).then(refresh)}>Save quotation</button>
      </div>
      <div className="card">
        <h2>Reserve / order</h2>
        <form onSubmit={createOrder}>
          <label>Customer
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              {customers.length === 0 ? <option value="">No customers yet</option> : null}
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>Slab
            <select value={slabId} onChange={(e) => setSlabId(e.target.value)}>
              {slabs.map((s) => <option key={s.id} value={s.id}>{s.slabSerial} ({s.salesStatus})</option>)}
            </select>
          </label>
          <label>Sqft<input value={qty} onChange={(e) => setQty(e.target.value)} /></label>
          <label>Rate<input value={rate} onChange={(e) => setRate(e.target.value)} /></label>
          <button type="submit">Confirm order</button>
        </form>
      </div>
      <div className="card">
        <h2>Orders</h2>
        {orders.length === 0 ? <EmptyState>No sales orders yet. Add a customer and confirm an order to populate this list.</EmptyState> : null}
        {orders.map((o) => (
          <p key={o.id}>
            {o.customer.name} — {o.status}
            <button type="button" onClick={() => apiFetch(`/api/v1/sales-orders/${o.id}/packing`, { method: "POST", body: JSON.stringify({ slabIds: o.lines.map((l) => l.slabId).filter(Boolean) }) }).then(refresh)}>Pack</button>
            <button type="button" onClick={() => apiFetch(`/api/v1/sales-orders/${o.id}/dispatch`, { method: "POST", body: JSON.stringify({ slabIds: o.lines.map((l) => l.slabId).filter(Boolean) }) }).then(refresh)}>Dispatch</button>
            <button type="button" onClick={() => apiFetch(`/api/v1/sales-orders/${o.id}/invoice`, { method: "POST", body: JSON.stringify({ clientOpId: crypto.randomUUID() }) }).then(refresh)}>Invoice</button>
            {o.invoices[0] ? (
              <button type="button" onClick={() => apiFetch(`/api/v1/invoices/${o.invoices[0]!.id}/payments`, { method: "POST", body: JSON.stringify({ amount: Number(o.invoices[0]!.amount), method: "cash", paidAt: new Date().toISOString().slice(0, 10), clientOpId: crypto.randomUUID() }) }).then(refresh)}>Record payment</button>
            ) : null}
            <button type="button" className="secondary" onClick={() => apiFetch(`/api/v1/sales-orders/${o.id}/returns`, { method: "POST", body: JSON.stringify({ slabIds: o.lines.map((l) => l.slabId).filter(Boolean), reason: "customer return" }) }).then(refresh)}>Return</button>
          </p>
        ))}
      </div>
    </AppShell>
  );
}
