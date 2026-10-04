"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { AppShell } from "../../components/AppShell";
import { apiFetch } from "../../lib/api";
import {
  DocumentReview,
  type DocumentFields,
} from "../../components/DocumentReview";
import { formatInr } from "../../lib/format";
type Row = Record<string, any>;
const money = (v: unknown) =>
  v === null || v === undefined ? "Missing" : formatInr(Number(v));
const number = (v: unknown) =>
  v === null || v === undefined
    ? "Missing"
    : Number(v).toLocaleString("en-IN", { maximumFractionDigits: 1 });
const pct = (v: unknown) =>
  v === null || v === undefined
    ? "Needs inputs"
    : (Number(v) * 100).toFixed(1) + "%";
function Table({
  heads,
  rows,
}: {
  heads: string[];
  rows: Array<React.ReactNode[] & { recordId?: string }>;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {heads.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row, i) => (
              <tr id={row.recordId} key={row.recordId ?? i}>
                {row.map((cell, j) => (
                  <td key={j}>{cell}</td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={heads.length}>No records yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
export default function AnalyticsPage() {
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Kolkata",
  });
  const [from, setFrom] = useState(today.slice(0, 7) + "-01"),
    [to, setTo] = useState(today);
  const [data, setData] = useState<Row | null>(null),
    [settings, setSettings] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [apiKey, setApiKey] = useState(""),
    [answer, setAnswer] = useState<Row | null>(null),
    [draft, setDraft] = useState<Row | null>(null),
    [draftFields, setDraftFields] = useState<DocumentFields | null>(null),
    [drafts, setDrafts] = useState<Row[]>([]);
  const load = async () => {
    const [d, s] = await Promise.all([
      apiFetch<Row>("/api/v1/reports/analytics?from=" + from + "&to=" + to),
      apiFetch<Row>("/api/v1/reports/analytics/settings"),
    ]);
    setData(d);
    setSettings(s);
    setDrafts(await apiFetch<Row[]>("/api/v1/reports/analytics/documents"));
  };
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    const reveal = () => {
      const id = decodeURIComponent(location.hash.slice(1));
      if (!id) return;
      const target = document.getElementById(id);
      if (!target) return;
      let parent: HTMLElement | null = target;
      while (parent) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
        parent = parent.parentElement;
      }
      target.scrollIntoView({ block: "center" });
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, [data]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not complete this request",
      );
    } finally {
      setBusy(false);
    }
  };
  const write = async (path: string, body: unknown) =>
    apiFetch<Row>("/api/v1/reports/analytics/" + path, {
      method: "POST",
      body: JSON.stringify(body),
      onlineOnly: true,
    });
  const form = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    return new FormData(e.currentTarget);
  };
  const link = (id: string, label: string) => {
    const source = data?.sources.find((s: Row) => s.id === id);
    return source ? <Link href={source.url}>{label} ↗</Link> : label;
  };
  const upload = async (file: File) => {
    if (file.size > 4 * 1024 * 1024)
      throw new Error("Choose a file under 4 MB");
    const encoded = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1]!);
      r.onerror = () => reject(new Error("File could not be read"));
      r.readAsDataURL(file);
    });
    const d = await write("documents", {
      fileName: file.name,
      contentType: file.type,
      base64: encoded,
    });
    setDraft(d);
    setDraftFields(d.parsed);
    setNotice("Draft created. Review every field before manual entry.");
  };
  return (
    <AppShell>
      <h1>Business insights</h1>
      <p>
        Sales, collections and expenses follow the selected document dates.
        Stock, costs and dispatch are current snapshots.
      </p>
      <form
        className="card row"
        onSubmit={(e) => {
          e.preventDefault();
          run(load);
        }}
      >
        <label>
          From
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            max={to}
            required
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            max={today}
            required
          />
        </label>
        <button disabled={busy}>Update period</button>
        <Link href="/sales/reports">Download party reports ↗</Link>
      </form>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {busy && <p role="status">Working…</p>}
      {data && (
        <>
          <div className="grid today-tiles">
            {[
              ["Net sales before GST", "netSales", "salesTarget"],
              ["Collections", "collections", "collectionTarget"],
              ["Expenses before GST", "expenses", null],
            ].map(([label, key, target]) => (
              <div className="metric" key={key!}>
                <span>{label}</span>
                <b>{money(data.current[key!])}</b>
                <small>Previous period: {money(data.previous[key!])}</small>
                {target && data.targets[target] > 0 && (
                  <small>
                    Target: {money(data.targets[target])} ·{" "}
                    {pct(data.current[key!] / data.targets[target])}
                  </small>
                )}
              </div>
            ))}
            <div className="metric">
              <span>Overdue receivables</span>
              <b>{money(data.collections.overdue)}</b>
              <small>Total dues: {money(data.collections.totalDue)}</small>
            </div>
          </div>
          <section className="card">
            <h2>Owner briefing</h2>
            {data.briefing.map((b: Row) => (
              <p key={b.source}>
                {b.text} {link(b.source, "Source")}
              </p>
            ))}
            <p className="muted">{data.dataQuality.note}</p>
            <p>
              {data.dataQuality.missingPurchaseCost} blocks lack purchase costs
              · {data.dataQuality.unconfirmedCosts} cost records need
              confirmation · {data.dataQuality.missingDueDates} unpaid invoices
              lack due dates.
            </p>
          </section>
          <section className="card">
            <h2>Ask StoneOS</h2>
            <p>
              OpenAI answers use this factory’s recorded figures and include
              source links. Check the sources before acting.
            </p>
            <form
              onSubmit={(e) => {
                const f = form(e);
                run(async () =>
                  setAnswer(
                    await write("ask", {
                      question: f.get("question"),
                      language: f.get("language"),
                      from,
                      to,
                    }),
                  ),
                );
              }}
            >
              <label>
                Your question
                <textarea
                  name="question"
                  maxLength={2000}
                  required
                  placeholder="Which collections should I follow up today?"
                />
              </label>
              <label>
                Language
                <select name="language">
                  <option value="en">English</option>
                  <option value="hi">हिन्दी</option>
                </select>
              </label>
              <button disabled={busy || !settings?.aiConfigured}>Ask</button>
            </form>
            {!settings?.aiConfigured && (
              <p>
                Connect OpenAI in settings below to enable answers and document
                reading.
              </p>
            )}
            {answer && (
              <div aria-live="polite">
                <p style={{ whiteSpace: "pre-wrap" }}>{answer.answer}</p>
                {answer.limitations.map((s: string, i: number) => (
                  <p className="muted" key={i}>
                    {s}
                  </p>
                ))}
                {answer.sources.map((s: Row) => (
                  <p key={s.id}>
                    <Link href={s.url}>{s.label} ↗</Link>
                  </p>
                ))}
              </div>
            )}
          </section>
          <section className="card" id="collections">
            <h2>Collection priorities & ageing</h2>
            <Table
              heads={["Bucket", "Amount"]}
              rows={data.collections.buckets.map((r: Row) => [
                r.bucket,
                money(r.amount),
              ])}
            />
            <Table
              heads={["Invoice / buyer", "Due", "Overdue", "Priority", "Terms"]}
              rows={data.collectionPriority.map((r: Row) =>
                Object.assign(
                  [
                    <span>
                      {link(r.source, r.number)}
                      <br />
                      {r.customer}
                    </span>,
                    money(r.amountDue),
                    r.daysOverdue === null
                      ? "Due date missing"
                      : r.daysOverdue + " days",
                    r.priority,
                    <details>
                      <summary>Set dates / note</summary>
                      <form
                        onSubmit={(e) => {
                          const f = form(e);
                          run(async () => {
                            await write("invoices/" + r.id + "/terms", {
                              dueDate: f.get("dueDate") || null,
                              promisedPaymentDate: f.get("promise") || null,
                              collectionNote: f.get("note") || null,
                            });
                            await load();
                          });
                        }}
                      >
                        <label>
                          Due date
                          <input
                            type="date"
                            name="dueDate"
                            defaultValue={r.dueDate ?? ""}
                            min={r.invoiceDate}
                          />
                        </label>
                        <label>
                          Promised payment
                          <input
                            type="date"
                            name="promise"
                            defaultValue={r.promisedPaymentDate ?? ""}
                          />
                        </label>
                        <label>
                          Follow-up note
                          <input
                            name="note"
                            maxLength={1000}
                            defaultValue={r.note ?? ""}
                          />
                        </label>
                        <button disabled={busy}>Save terms</button>
                      </form>
                    </details>,
                  ],
                  { recordId: "invoice-" + r.id },
                ),
              )}
            />
          </section>
          <details className="card" id="stock">
            <summary>
              <h2>Stock ageing</h2>
            </summary>
            <p>
              As of {data.stockAsOf}. Recorded remaining value excludes GST and
              may omit costs that have not been entered.
            </p>
            <Table
              heads={[
                "Block",
                "Variety / stage",
                "Age",
                "Available / to dispatch",
                "Remaining recorded value",
              ]}
              rows={data.stock.map((r: Row) => [
                link(r.source, r.serial),
                r.variety + " · " + r.stage,
                r.ageDays + " days",
                r.availableSlabs + " / " + r.heldForDispatch,
                money(r.remainingRecordedValue),
              ])}
            />
          </details>
          <details className="card" id="costs">
            <summary>
              <h2>Block costs, margin & recovery</h2>
            </summary>
            <p>
              Costs are allocated by sale area. Confirm all stone, transport,
              cutting, polishing and other block expenses before treating a
              sold-out block’s margin as final.
            </p>
            <Table
              heads={[
                "Block",
                "Net revenue",
                "Recorded cost",
                "Estimated / final margin",
                "Yield / sold recovery (sqft/ton)",
                "Breakage",
                "Cost status",
              ]}
              rows={data.blockCosts.map((r: Row) =>
                Object.assign(
                  [
                    link(r.source, r.serial),
                    money(r.revenue),
                    <span>
                      {money(r.totalRecordedCost)}
                      <br />
                      Estimated landed: {money(r.estimatedLandedCost)}
                      <br />
                      Royalty: {money(r.royaltyExpected)} · Transport:{" "}
                      {money(r.transportExpected)}
                      <br />
                      Pending expense costs: {money(r.pendingPerTonCost)}
                    </span>,
                    money(r.estimatedMargin) +
                      " / " +
                      (r.finalMargin === null
                        ? "Pending"
                        : money(r.finalMargin)),
                    number(r.productionYield) + " / " + number(r.soldRecovery),
                    r.cutBroken + " cut · " + r.yardBroken + " yard",
                    <div>
                      {r.costStatus}
                      <br />
                      <details>
                        <summary>Per-ton rates</summary>
                        <form
                          onSubmit={(e) => {
                            const f = form(e);
                            run(async () => {
                              await write(
                                "blocks/" + r.id + "/rates",
                                Object.fromEntries(
                                  [
                                    "blockPricePerTon",
                                    "royaltyPerTon",
                                    "transportPerTon",
                                  ].map((k) => [
                                    k,
                                    f.get(k) ? Number(f.get(k)) : null,
                                  ]),
                                ),
                              );
                              await load();
                            });
                          }}
                        >
                          {[
                            ["blockPricePerTon", "Block price"],
                            ["royaltyPerTon", "Block royalty"],
                            ["transportPerTon", "Transport rent"],
                          ].map(([key, label]) => (
                            <label key={key}>
                              {label} (₹/ton)
                              <input
                                type="number"
                                name={key}
                                min="0"
                                step="0.01"
                                defaultValue={r[key!] ?? ""}
                              />
                            </label>
                          ))}
                          <button disabled={busy}>Save rates</button>
                        </form>
                      </details>
                      <button
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            await write("blocks/" + r.id + "/costs", {
                              confirmed: !r.costsConfirmed,
                            });
                            await load();
                          })
                        }
                      >
                        {r.costsConfirmed
                          ? "Reopen costs"
                          : "Confirm all costs"}
                      </button>
                    </div>,
                  ],
                  { recordId: "block-" + r.id },
                ),
              )}
            />
            <h3>By variety — current cumulative margin</h3>
            <Table
              heads={[
                "Variety",
                "Blocks",
                "Net revenue",
                "Estimated margin",
                "Unconfirmed costs",
              ]}
              rows={data.varieties.map((r: Row) => [
                r.variety,
                r.blocks,
                money(r.revenue),
                money(r.estimatedMargin),
                r.unconfirmed,
              ])}
            />
          </details>
          <details className="card" id="machines">
            <summary>
              <h2>Machine productivity</h2>
            </summary>
            <p>
              OEE needs planned hours, ideal output and complete quality
              records. Recording-day figures are not a full shift calendar.
            </p>
            <Table
              heads={[
                "Machine",
                "Runtime / downtime",
                "Good sqft / sqft per hour",
                "Availability / performance / quality",
                "OEE",
                "Standard",
              ]}
              rows={data.machines.map((r: Row) =>
                Object.assign(
                  [
                    r.name,
                    number(r.runtimeHours) +
                      " h / " +
                      number(r.downtimeMinutes) +
                      " min",
                    number(r.goodSqft) + " / " + number(r.sqftPerHour),
                    pct(r.availability) +
                      " / " +
                      pct(r.performance) +
                      " / " +
                      pct(r.quality),
                    <span title={r.note}>{pct(r.oee)}</span>,
                    <details>
                      <summary>Set standard</summary>
                      <form
                        onSubmit={(e) => {
                          const f = form(e);
                          run(async () => {
                            await write("machines/" + r.id + "/standard", {
                              plannedHoursPerDay: f.get("hours")
                                ? Number(f.get("hours"))
                                : null,
                              idealSqftPerHour: f.get("rate")
                                ? Number(f.get("rate"))
                                : null,
                            });
                            await load();
                          });
                        }}
                      >
                        <label>
                          Planned hours/day
                          <input
                            name="hours"
                            type="number"
                            min="0.1"
                            max="24"
                            step="0.1"
                            defaultValue={r.plannedHoursPerDay ?? ""}
                          />
                        </label>
                        <label>
                          Ideal sqft/hour
                          <input
                            name="rate"
                            type="number"
                            min="0.001"
                            step="0.001"
                            defaultValue={r.idealSqftPerHour ?? ""}
                          />
                        </label>
                        <button disabled={busy}>Save standard</button>
                      </form>
                    </details>,
                  ],
                  { recordId: "machine-" + r.id },
                ),
              )}
            />
          </details>
          <details className="card">
            <summary>
              <h2>Pending dispatch</h2>
            </summary>
            <Table
              heads={[
                "Buyer",
                "Remaining slabs",
                "Promised delivery",
                "Status",
                "Update",
              ]}
              rows={data.pendingOrders.map((r: Row) =>
                Object.assign(
                  [
                    link(r.source, r.customer),
                    r.lines.reduce((n: number, l: Row) => n + l.remaining, 0),
                    r.promisedDate ?? "Missing",
                    r.delayed ? "Delayed" : "Open",
                    <form
                      onSubmit={(e) => {
                        const f = form(e);
                        run(async () => {
                          await write("orders/" + r.id + "/delivery", {
                            date: f.get("date") || null,
                          });
                          await load();
                        });
                      }}
                    >
                      <label>
                        Promised date
                        <input
                          type="date"
                          name="date"
                          defaultValue={r.promisedDate ?? ""}
                        />
                      </label>
                      <button disabled={busy}>Save</button>
                    </form>,
                  ],
                  { recordId: "order-" + r.id },
                ),
              )}
            />
          </details>
          <details className="card">
            <summary>
              <h2>Buyer & supplier comparison</h2>
            </summary>
            <Table
              heads={[
                "Buyer",
                "Period net sales",
                "Dues",
                "Overdue",
                "Payments recorded",
                "Estimated cumulative margin",
              ]}
              rows={data.customers.map((r: Row) => [
                link(r.source, r.name),
                money(r.netSales),
                money(r.dues),
                money(r.overdue),
                r.paymentCount,
                <span title={r.marginBasis}>
                  {money(r.estimatedLifetimeMargin)}
                </span>,
              ])}
            />
            <p>
              Supplier yield is weighted by produced-block tons. Cost/sqft
              includes entered costs only.
            </p>
            <Table
              heads={[
                "Supplier",
                "Blocks / tons",
                "Production sqft/ton",
                "Recorded cost/sqft",
                "Damaged slabs",
              ]}
              rows={data.suppliers.map((r: Row) => [
                link(r.source, r.name),
                r.blocks + " / " + number(r.tons),
                number(r.productionYield),
                money(r.landedCostPerSqft),
                r.damagedSlabs,
              ])}
            />
          </details>
          <details className="card">
            <summary>
              <h2>Monthly trends & planning baseline</h2>
            </summary>
            <div aria-label="Monthly collection comparison">
              {data.trends.map((r: Row) => (
                <div
                  key={r.month}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "70px 1fr 90px",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <span>{r.month}</span>
                  <div
                    style={{
                      background: "var(--line)",
                      height: 16,
                      borderRadius: 4,
                    }}
                  >
                    <div
                      style={{
                        height: 16,
                        borderRadius: 4,
                        background: "var(--ok)",
                        width:
                          (100 * r.collections) /
                            Math.max(
                              1,
                              ...data.trends.map((m: Row) => m.collections),
                            ) +
                          "%",
                      }}
                    />
                  </div>
                  <small>{money(r.collections)}</small>
                </div>
              ))}
            </div>
            <Table
              heads={[
                "Month",
                "Net sales",
                "Collections",
                "Expenses",
                "Sold sqft",
              ]}
              rows={data.trends.map((r: Row) => [
                r.month,
                money(r.netSales),
                money(r.collections),
                money(r.expenses),
                number(r.soldSqft),
              ])}
            />
            <p>{data.forecast.reason}</p>
            {data.forecast.ready && (
              <p>
                Next-month collection baseline:{" "}
                {money(data.forecast.collections.baseline)} · historical
                low/high: {money(data.forecast.collections.lower)} /{" "}
                {money(data.forecast.collections.upper)}. Sold area baseline:{" "}
                {number(data.forecast.soldSqft.baseline)} sqft.
              </p>
            )}
          </details>
          <details className="card">
            <summary>
              <h2>Items to review</h2>
            </summary>
            {data.alerts.length ? (
              data.alerts.map((r: Row) => (
                <p key={r.id}>
                  {r.message} {link(r.source, "Review record")}
                </p>
              ))
            ) : (
              <p>No exceptions identified from available records.</p>
            )}
          </details>
        </>
      )}
      <section className="card">
        <h2>Read a supplier bill or delivery note</h2>
        <p>
          Upload a clear image or PDF, up to 4 MB. Reading uses OpenAI and
          creates a draft for review. Approved drafts are kept for manual entry.
        </p>
        <label>
          Document
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            disabled={busy || !settings?.aiConfigured}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) run(() => upload(file));
              e.target.value = "";
            }}
          />
        </label>
        <label>
          Reopen a document draft
          <select
            value={draft?.id ?? ""}
            onChange={(e) => {
              const d = drafts.find((d) => d.id === e.target.value);
              if (d) {
                setDraft(d);
                setDraftFields(d.parsed);
              }
            }}
          >
            <option value="">Choose draft</option>
            {drafts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.parsed?.invoiceNumber ?? d.kind} · {d.status}
              </option>
            ))}
          </select>
        </label>
        {draft && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                const result = await write(
                  "documents/" + draft.id + "/review",
                  draftFields,
                );
                setDraft(result);
                setNotice(result.note);
              });
            }}
          >
            {draftFields && (
              <DocumentReview value={draftFields} onChange={setDraftFields} />
            )}
            <p>
              Null means missing or uncertain. Check amounts, dates, party and
              every line against the original.
            </p>
            <button disabled={busy}>Save reviewed draft</button>
            <Link href="/intake">Open drafts ↗</Link>
          </form>
        )}
      </section>
      <details className="card">
        <summary>Targets & OpenAI settings</summary>
        <form
          onSubmit={(e) => {
            const f = form(e);
            run(async () => {
              const targets: Record<string, number> = {};
              for (const key of [
                "salesTarget",
                "collectionTarget",
                "recoveryTarget",
                "damagePctTarget",
                "sqftPerHourTarget",
              ]) {
                if (f.get(key) !== "") targets[key] = Number(f.get(key));
              }
              await write("settings", {
                targets,
                ...(apiKey ? { apiKey } : {}),
              });
              setApiKey("");
              await load();
              setNotice("Settings saved.");
            });
          }}
        >
          {[
            ["salesTarget", "Period sales target (₹)"],
            ["collectionTarget", "Period collection target (₹)"],
            ["recoveryTarget", "Production yield target (sqft/ton)"],
            ["damagePctTarget", "Breakage alert (%)"],
            ["sqftPerHourTarget", "Productivity target (sqft/hour)"],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                name={key}
                type="number"
                min="0"
                step="0.01"
                defaultValue={settings?.targets?.[key!] ?? ""}
              />
            </label>
          ))}
          <p>
            Provider: OpenAI ·{" "}
            {settings?.aiConfigured ? "Connected" : "Not configured"} ·
            Statutory mode: test
          </p>
          <label>
            OpenAI API key
            <input
              type="password"
              autoComplete="new-password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter securely here"
            />
          </label>
          <p className="muted">
            The key is encrypted on the server and is never saved in the offline
            queue. OpenAI requests send the selected factory analytics or
            document for processing.
          </p>
          <button disabled={busy}>Save settings</button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await write("settings", { clearKey: true });
                await load();
                setNotice(
                  "Saved provider key removed. A server-configured key may still be active.",
                );
              })
            }
          >
            Remove saved key
          </button>
        </form>
      </details>
    </AppShell>
  );
}
