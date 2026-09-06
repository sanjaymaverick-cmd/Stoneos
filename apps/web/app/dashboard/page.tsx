"use client";

import { FormEvent, useEffect, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { apiFetch } from "../../lib/api";

type ShopMetrics = {
  blocksOnHand: number;
  slabsOnHand: number;
  openCutting: number;
  openOrders: number;
  maintenanceDue: number;
};

type CeoBrief = ShopMetrics & {
  factoryName: string;
  operatingStatus: string;
  generatedAt: string;
  briefKind: string;
  narrative: string;
  openPolishing: number;
  invoicedTotal: number;
  collectedTotal: number;
  outstandingAr: number;
  invoicedMtd: number;
  collectedMtd: number;
  expensesMtd: number;
  damagedCost: number;
  recoveryRatio: number | null;
  recoveryBenchmark: number;
  exceptions: Array<{ code: string; severity: string; message: string }>;
};

type ChatTurn = { role: "user" | "copilot"; text: string };

function inr(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function recoveryClass(ratio: number | null, bench: number) {
  if (ratio === null) return "";
  if (ratio < 90) return "bad";
  if (ratio < bench) return "warn";
  return "ok";
}

const PROMPTS = [
  "How is recovery vs 105?",
  "What is outstanding AR?",
  "Yard stock right now?",
  "Cutting and polish WIP?",
];

export default function DashboardPage() {
  const [shop, setShop] = useState<ShopMetrics | null>(null);
  const [ceo, setCeo] = useState<CeoBrief | null>(null);
  const [factory, setFactory] = useState<{ name: string; operatingStatus: string } | null>(null);
  const [question, setQuestion] = useState("");
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    apiFetch<ShopMetrics>("/api/v1/reports/dashboard").then(setShop).catch(() => undefined);
    apiFetch<{ name: string; operatingStatus: string }>("/api/v1/factory/me")
      .then(setFactory)
      .catch(() => undefined);
    apiFetch<CeoBrief>("/api/v1/reports/ceo")
      .then((brief) => {
        setCeo(brief);
        if (brief.narrative) setChat([{ role: "copilot", text: brief.narrative }]);
      })
      .catch(() => undefined);
  }, []);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || asking) return;
    setAsking(true);
    setChat((c) => [...c, { role: "user", text: q }]);
    setQuestion("");
    try {
      const res = await apiFetch<{ answer: string }>("/api/v1/reports/ceo/ask", {
        method: "POST",
        body: JSON.stringify({ question: q }),
      });
      setChat((c) => [...c, { role: "copilot", text: res.answer }]);
    } catch {
      setChat((c) => [...c, { role: "copilot", text: "Copilot could not read the ledger snapshot." }]);
    } finally {
      setAsking(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void ask(question);
  }

  const name = ceo?.factoryName ?? factory?.name ?? "Factory";
  const status = ceo?.operatingStatus ?? factory?.operatingStatus ?? "loading…";
  const floor = ceo ?? shop;

  return (
    <AppShell>
      <div className="wide">
        <div className="dash-head">
          <div>
            <h1>{name}</h1>
            <p style={{ margin: "6px 0 0" }}>KPI dashboard · snapshot Copilot on factory books</p>
          </div>
          <span className={`badge ${status === "LIVE" ? "live" : ""}`}>{status}</span>
        </div>

        <div className="grid">
          {ceo ? (
            <div className={`metric ${recoveryClass(ceo.recoveryRatio, ceo.recoveryBenchmark)}`}>
              <span>Recovery</span>
              <b>{ceo.recoveryRatio === null ? "—" : ceo.recoveryRatio.toFixed(1)}</b>
              <span className="hint">sqft / ton · bench {ceo.recoveryBenchmark}</span>
            </div>
          ) : null}
          {ceo ? (
            <div className={`metric ${ceo.outstandingAr >= 500000 ? "warn" : ""}`}>
              <span>Outstanding AR</span>
              <b>{inr(ceo.outstandingAr)}</b>
              <span className="hint">invoiced {inr(ceo.invoicedTotal)}</span>
            </div>
          ) : null}
          {ceo ? (
            <div className="metric">
              <span>Invoiced MTD</span>
              <b>{inr(ceo.invoicedMtd)}</b>
            </div>
          ) : null}
          {ceo ? (
            <div className="metric">
              <span>Collected MTD</span>
              <b>{inr(ceo.collectedMtd)}</b>
            </div>
          ) : null}
          <div className="metric">
            <span>Blocks on hand</span>
            <b>{floor?.blocksOnHand ?? "—"}</b>
          </div>
          <div className="metric">
            <span>Slabs on hand</span>
            <b>{floor?.slabsOnHand ?? "—"}</b>
          </div>
          <div className="metric">
            <span>Open cutting</span>
            <b>{floor?.openCutting ?? "—"}</b>
          </div>
          <div className="metric">
            <span>Open orders</span>
            <b>{floor?.openOrders ?? "—"}</b>
          </div>
          {ceo ? (
            <div className="metric">
              <span>Open polish</span>
              <b>{ceo.openPolishing}</b>
            </div>
          ) : null}
          <div className="metric">
            <span>Maintenance due</span>
            <b>{floor?.maintenanceDue ?? "—"}</b>
          </div>
          {ceo ? (
            <div className="metric">
              <span>Expenses MTD</span>
              <b>{inr(ceo.expensesMtd)}</b>
            </div>
          ) : null}
          {ceo ? (
            <div className="metric">
              <span>Damaged cost</span>
              <b>{inr(ceo.damagedCost)}</b>
              <span className="hint">raw-block rate</span>
            </div>
          ) : null}
        </div>

        {ceo ? (
          <div className="dash-split">
            <section className="card">
              <h2>Analytics</h2>
              <p>{ceo.narrative}</p>
              {ceo.exceptions.length === 0 ? (
                <p className="empty">No rule exceptions on this snapshot.</p>
              ) : (
                <ul>
                  {ceo.exceptions.map((ex) => (
                    <li key={ex.code} className={`sev-${ex.severity}`}>
                      <strong>{ex.severity}</strong> — {ex.message}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="card copilot">
              <h2>Copilot</h2>
              <p className="hint">Answers only from this factory’s ledger snapshot. No external model.</p>
              <div className="chips">
                {PROMPTS.map((p) => (
                  <button key={p} type="button" className="chip" onClick={() => void ask(p)}>
                    {p}
                  </button>
                ))}
              </div>
              <div className="copilot-log">
                {chat.map((turn, i) => (
                  <div key={i} className={`bubble ${turn.role === "user" ? "user" : ""}`}>
                    {turn.text}
                  </div>
                ))}
              </div>
              <form onSubmit={onSubmit}>
                <input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Ask about recovery, AR, stock…"
                  aria-label="Copilot question"
                />
                <button type="submit" disabled={asking}>
                  {asking ? "Reading books…" : "Ask"}
                </button>
              </form>
            </section>
          </div>
        ) : (
          <p className="empty">Shop-floor KPIs only. Commercial Copilot is limited to owner, manager, accountant, auditor, and admin.</p>
        )}
      </div>
    </AppShell>
  );
}
