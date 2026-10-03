"use client";

/*
 * What is still to leave the gate.
 *
 * Dispatch happens later than the sale and usually by someone else, so this is its
 * own screen rather than a step tacked onto selling. One card per order, one row
 * per lot still owed, and a box for how many are going on this lorry.
 *
 * Nothing here moves stock: the sale already took these slabs out of the yard.
 * This records that they physically went, which is why an order can be fully sold
 * and still be sitting in the shed.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AppShell } from "../../../components/AppShell";
import { EmptyState } from "../../../components/EmptyState";
import { apiFetch, isQueued } from "../../../lib/api";

type PendingLot = {
  blockSerial: string | null;
  variety: string | null;
  ordered: number;
  dispatched: number;
  stillToGo: number;
};

type PendingOrder = {
  orderId: string;
  customer: string;
  orderDate: string;
  status: string;
  lots: PendingLot[];
};

type DispatchResult = {
  deliveryId: string;
  orderStatus: string;
  sent: Array<{ blockSerial: string | null; slabCount: number | null }>;
  outstanding: Array<{ blockSerial: string | null; stillToGo: number }>;
};

export default function DispatchPage() {
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [going, setGoing] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const opIds = useRef<Record<string, string>>({});

  const load = useCallback(async () => {
    setOrders(await apiFetch<PendingOrder[]>("/api/v1/lots/pending-dispatch"));
  }, []);

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, [load]);

  const key = (orderId: string, serial: string | null) => `${orderId}:${serial}`;

  /** Everything the clerk has typed against this order, as a load. */
  function loadFor(order: PendingOrder) {
    return order.lots
      .map((lot) => ({
        blockSerial: lot.blockSerial ?? "",
        slabCount: Number(going[key(order.orderId, lot.blockSerial)] ?? 0),
      }))
      .filter((line) => line.blockSerial && line.slabCount > 0);
  }

  async function send(order: PendingOrder) {
    const lines = loadFor(order);
    setNotice("");
    setError("");
    if (lines.length === 0) {
      setError("Enter how many slabs are going on this lorry");
      return;
    }
    // Over-asking is refused by the server, but the clerk should find out here.
    for (const line of lines) {
      const lot = order.lots.find((l) => l.blockSerial === line.blockSerial)!;
      if (line.slabCount > lot.stillToGo) {
        setError(
          `${lot.blockSerial} has ${lot.stillToGo} still to go, so ${line.slabCount} cannot be sent`,
        );
        return;
      }
    }

    // A stable key per load, so a double-tap or a lost reply is one lorry, not two.
    const stamp = lines.map((l) => `${l.blockSerial}x${l.slabCount}`).sort().join(",");
    const opKey = `${order.orderId}:${stamp}`;
    opIds.current[opKey] ??= crypto.randomUUID();

    setBusy(order.orderId);
    try {
      const result = await apiFetch<DispatchResult>("/api/v1/lots/dispatch", {
        method: "POST",
        label: `Dispatch · ${order.customer}`,
        body: JSON.stringify({
          orderId: order.orderId,
          lines,
          clientOpId: opIds.current[opKey],
        }),
      });
      if (isQueued(result)) {
        setNotice("Dispatch saved on this device; it will sync.");
      } else {
        delete opIds.current[opKey];
        const sent = result.sent
          .map((s) => `${s.blockSerial} × ${s.slabCount}`)
          .join(", ");
        setNotice(
          result.orderStatus === "DELIVERED"
            ? `${sent} sent. ${order.customer}'s order is complete.`
            : `${sent} sent. ${result.outstanding
                .map((o) => `${o.blockSerial} × ${o.stillToGo}`)
                .join(", ")} still to go.`,
        );
      }
      setGoing({});
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  return (
    <AppShell>
      <div className="page">
        <div className="dash-head">
          <h1>To dispatch</h1>
          <p className="muted">
            Sold but not yet gone. Stock came off the yard when the sale was made —
            this records the lorry leaving.
          </p>
        </div>

        {notice ? <p className="hint">{notice}</p> : null}
        {error ? <p className="error">{error}</p> : null}

        {orders.length === 0 ? (
          <div className="card">
            <EmptyState>
              Nothing waiting to go out. <Link href="/lots/sell">Sell from a lot →</Link>
            </EmptyState>
          </div>
        ) : null}

        {orders.map((order) => (
          <div className="card wide" key={order.orderId}>
            <h2>{order.customer}</h2>
            <p className="muted">
              {String(order.orderDate).slice(0, 10)} · {order.status}
            </p>
            <table>
              <thead>
                <tr>
                  <th>Block</th>
                  <th>Variety</th>
                  <th className="num">Ordered</th>
                  <th className="num">Gone</th>
                  <th className="num">Still to go</th>
                  <th>On this lorry</th>
                </tr>
              </thead>
              <tbody>
                {order.lots.map((lot) => (
                  <tr key={lot.blockSerial}>
                    <td>
                      <strong>{lot.blockSerial}</strong>
                    </td>
                    <td>{lot.variety}</td>
                    <td className="num muted">{lot.ordered}</td>
                    <td className="num muted">{lot.dispatched}</td>
                    <td className="num">
                      <strong>{lot.stillToGo}</strong>
                    </td>
                    <td>
                      <input
                        inputMode="numeric"
                        aria-label={`Slabs of ${lot.blockSerial} on this lorry`}
                        value={going[key(order.orderId, lot.blockSerial)] ?? ""}
                        placeholder={String(lot.stillToGo)}
                        onChange={(e) =>
                          setGoing((g) => ({
                            ...g,
                            [key(order.orderId, lot.blockSerial)]: e.target.value,
                          }))
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              type="button"
              disabled={busy === order.orderId}
              onClick={() => void send(order)}
            >
              {busy === order.orderId ? "Sending…" : "Send this lorry"}
            </button>{" "}
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setGoing((g) => {
                  const next = { ...g };
                  for (const lot of order.lots) {
                    next[key(order.orderId, lot.blockSerial)] = String(lot.stillToGo);
                  }
                  return next;
                });
              }}
            >
              Send everything
            </button>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
