#!/usr/bin/env node
/**
 * Full-volume dry company run against a live StoneOS API.
 *
 * Simulates a working granite yard: 4-5k sqft cut and polished per working day,
 * 90-100k sqft sold per month, every staff role doing its own job, plus month-end
 * wages, returns, books and reports. Every non-2xx that was not expected is recorded
 * with the request that caused it.
 *
 * Usage (bash):
 *   STONEOS_API_URL=http://193.122.159.175 STONEOS_OWNER_PASSWORD='…' \
 *     node .grok/skills/factory-year-run/scripts/volume-run.mjs
 *
 * Env:
 *   STONEOS_API_URL        API origin (default http://localhost:4000). Routes are /api/v1/…
 *   STONEOS_OWNER_USER     default "owner"
 *   STONEOS_OWNER_PASSWORD required
 *   MONTHS                 months to simulate (default 12)
 *   START_MONTH            YYYY-MM to start (default: 12 months before the current month)
 *   RUN_PREFIX             username / serial prefix (default "dry")
 *   SEED                   PRNG seed (default 42)
 *
 * Outputs (var/ is gitignored):
 *   var/volume-run-report.json   full machine-readable report, rewritten after every month
 *   var/volume-run-report.md     human summary
 *   var/dry-run-credentials.json staff usernames + passwords created by this run
 */
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

const API = (process.env.STONEOS_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");
const OWNER_USER = process.env.STONEOS_OWNER_USER ?? "owner";
const OWNER_PASS = process.env.STONEOS_OWNER_PASSWORD;
const MONTHS = Number(process.env.MONTHS ?? 12);
const PREFIX = (process.env.RUN_PREFIX ?? "dry").toLowerCase();
const SEED = Number(process.env.SEED ?? 42);
const OUT_DIR = path.resolve("var");
const V1 = "/api/v1";

if (!OWNER_PASS) {
  console.error("Set STONEOS_OWNER_PASSWORD (the owner's current password).");
  process.exit(2);
}

const ROLES = ["manager", "admin", "supervisor", "operator", "inventory", "sales", "accountant", "auditor"];

// ---------- deterministic randomness ----------
let seedState = SEED >>> 0;
function rand() {
  seedState = (seedState + 0x6d2b79f5) >>> 0;
  let t = seedState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (lo, hi) => lo + rand() * (hi - lo);
const intBetween = (lo, hi) => Math.floor(between(lo, hi + 1));
const pick = (list) => list[Math.floor(rand() * list.length)];
const round2 = (n) => Math.round(n * 100) / 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- report ----------
const report = {
  api: API,
  prefix: PREFIX,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  aborted: null,
  factory: null,
  context: "",
  requestCount: 0,
  failures: [],
  warnings: [],
  rbac: [],
  routes: {},
  months: [],
  totals: {
    blocks: 0,
    tonsReceived: 0,
    slabsCut: 0,
    slabsGood: 0,
    sqftProduced: 0,
    slabsPolished: 0,
    orders: 0,
    cashSales: 0,
    invoices: 0,
    sqftSold: 0,
    invoicedAmount: 0,
    cashSaleAmount: 0,
    paymentsReceived: 0,
    returns: 0,
    expenses: 0,
    expenseAmount: 0,
    attendanceMarks: 0,
  },
  notes: [],
};

function routeKey(method, pathName) {
  const bare = pathName.split("?")[0].replace(V1, "");
  return `${method} ${bare.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")}`;
}

function recordLatency(key, status, ms) {
  const r = (report.routes[key] ??= { count: 0, statuses: {}, ms: [] });
  r.count += 1;
  r.statuses[status] = (r.statuses[status] ?? 0) + 1;
  r.ms.push(Math.round(ms));
}

// ---------- HTTP with per-token throttle, 429 back-off, network retry, 401 re-login ----------
const PER_TOKEN_PER_MIN = 540; // server allows 600/min per IP+token
const tokenWindows = new Map();
async function throttle(token) {
  const key = token ?? "anon";
  const limit = token ? PER_TOKEN_PER_MIN : 100;
  const now = Date.now();
  const list = (tokenWindows.get(key) ?? []).filter((t) => now - t < 60_000);
  if (list.length >= limit) {
    await sleep(60_000 - (now - list[0]) + 50);
  }
  list.push(Date.now());
  tokenWindows.set(key, list);
}

const sessions = {}; // role -> { username, password, token }

async function raw(method, pathName, token, body) {
  await throttle(token);
  const started = performance.now();
  const res = await fetch(`${API}${pathName}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const ms = performance.now() - started;
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  return { status: res.status, ok: res.ok, body: json, ms };
}

function trimBody(body) {
  const s = JSON.stringify(body ?? null);
  return s.length > 1500 ? `${s.slice(0, 1500)}…(${s.length} chars)` : JSON.parse(s);
}

/**
 * as: role name (uses its session) or null for anonymous.
 * expect: array of acceptable statuses; default any 2xx.
 * soft: 4xx is a warning, only 5xx / network is a failure.
 */
async function call(as, method, pathName, { body, expect, soft, label } = {}) {
  const fullPath = pathName.startsWith("/api") || pathName.startsWith("/health") ? pathName : `${V1}${pathName}`;
  const key = routeKey(method, fullPath);
  let attempt = 0;
  let relogged = false;
  for (;;) {
    attempt += 1;
    let res;
    try {
      res = await raw(method, fullPath, as ? sessions[as]?.token : undefined, body);
    } catch (error) {
      if (attempt <= 3) {
        report.warnings.push({ context: report.context, route: key, note: `network error, retry ${attempt}: ${error.message}` });
        await sleep(2000 * attempt);
        continue;
      }
      report.failures.push({ context: report.context, as, route: key, status: "NETWORK", error: error.message, request: trimBody(body) });
      return { status: 0, ok: false, body: null };
    }
    report.requestCount += 1;
    recordLatency(key, res.status, res.ms);
    if (res.status === 429 && attempt <= 4) {
      report.warnings.push({ context: report.context, route: key, note: "429 rate limited; waiting 65s" });
      await sleep(65_000);
      continue;
    }
    if (res.status === 401 && as && !relogged && sessions[as]?.password) {
      relogged = true;
      await login(as, sessions[as].username, sessions[as].password);
      continue;
    }
    const acceptable = expect ? expect.includes(res.status) : res.ok;
    if (!acceptable) {
      const entry = {
        context: report.context,
        as,
        route: key,
        label,
        status: res.status,
        expected: expect ?? "2xx",
        response: trimBody(res.body),
        request: trimBody(body),
      };
      if (soft && res.status < 500) report.warnings.push(entry);
      else report.failures.push(entry);
    }
    return res;
  }
}

async function login(role, username, password) {
  const res = await call(null, "POST", "/auth/login", { body: { username, password }, label: `login ${role}` });
  if (!res.ok) throw new Error(`login failed for ${username} (${role}): ${res.status} ${JSON.stringify(res.body)}`);
  sessions[role] = { username, password, token: res.body.token, user: res.body.user };
  return res.body;
}

function strongPassword() {
  return `Dry-${randomBytes(9).toString("base64url")}!7`;
}

// ---------- persistence ----------
async function writeReport() {
  await mkdir(OUT_DIR, { recursive: true });
  const routes = Object.fromEntries(
    Object.entries(report.routes).map(([k, r]) => {
      const sorted = [...r.ms].sort((a, b) => a - b);
      const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
      return [k, { count: r.count, statuses: r.statuses, p50: q(0.5), p95: q(0.95), max: sorted.at(-1) }];
    }),
  );
  const out = { ...report, routes };
  await writeFile(path.join(OUT_DIR, "volume-run-report.json"), JSON.stringify(out, null, 2));
  await writeFile(path.join(OUT_DIR, "volume-run-report.md"), markdown(out));
}

function inr(n) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function markdown(out) {
  const t = out.totals;
  const lines = [];
  lines.push(`# StoneOS volume dry run`, "");
  lines.push(`- API: ${out.api}`);
  lines.push(`- Started ${out.startedAt}, finished ${out.finishedAt ?? "(running / aborted)"}`);
  if (out.aborted) lines.push(`- **Aborted:** ${out.aborted}`);
  lines.push(`- Requests: ${out.requestCount}; unexpected failures: **${out.failures.length}**; warnings: ${out.warnings.length}`, "");
  lines.push(`## Totals`, "");
  lines.push(`| Metric | Value |`, `|---|---|`);
  lines.push(`| Blocks received | ${t.blocks} (${round2(t.tonsReceived)} t) |`);
  lines.push(`| Slabs cut / good / polished | ${t.slabsCut} / ${t.slabsGood} / ${t.slabsPolished} |`);
  lines.push(`| Sqft produced | ${Math.round(t.sqftProduced).toLocaleString("en-IN")} |`);
  lines.push(`| Orders / invoices / cash sales | ${t.orders} / ${t.invoices} / ${t.cashSales} |`);
  lines.push(`| Sqft sold | ${Math.round(t.sqftSold).toLocaleString("en-IN")} |`);
  lines.push(`| Invoiced (incl. GST) | ${inr(t.invoicedAmount)} |`);
  lines.push(`| Cash sales | ${inr(t.cashSaleAmount)} |`);
  lines.push(`| Payments received | ${inr(t.paymentsReceived)} |`);
  lines.push(`| Returns | ${t.returns} |`);
  lines.push(`| Expenses | ${t.expenses} (${inr(t.expenseAmount)}) |`);
  lines.push(`| Attendance marks | ${t.attendanceMarks} |`, "");
  lines.push(`## Months`, "");
  lines.push(`| Month | Workdays | Blocks | Sqft produced | Sqft sold | Invoices | Failures |`, `|---|---|---|---|---|---|---|`);
  for (const m of out.months) {
    lines.push(`| ${m.month} | ${m.workdays} | ${m.blocks} | ${Math.round(m.sqftProduced).toLocaleString("en-IN")} | ${Math.round(m.sqftSold).toLocaleString("en-IN")} | ${m.invoices} | ${m.failures} |`);
  }
  lines.push("", `## Role checks`, "");
  lines.push(`| Check | Expected | Got | Pass |`, `|---|---|---|---|`);
  for (const r of out.rbac) lines.push(`| ${r.check} | ${r.expected} | ${r.got} | ${r.pass ? "yes" : "**NO**"} |`);
  lines.push("", `## Failures grouped`, "");
  const groups = new Map();
  for (const f of out.failures) {
    const msg = typeof f.response === "object" && f.response ? f.response.message ?? f.response.error ?? "" : f.error ?? "";
    const k = `${f.route} → ${f.status} ${typeof msg === "string" ? msg : JSON.stringify(msg)}`;
    const g = groups.get(k) ?? { count: 0, first: f };
    g.count += 1;
    groups.set(k, g);
  }
  if (groups.size === 0) lines.push("None.");
  for (const [k, g] of [...groups.entries()].sort((a, b) => b[1].count - a[1].count)) {
    lines.push(`- **${g.count}×** \`${k}\` — first at ${g.first.context} as ${g.first.as ?? "anon"}`);
  }
  lines.push("", `## Slowest routes (p95 ms)`, "");
  lines.push(`| Route | Calls | p50 | p95 | max | Statuses |`, `|---|---|---|---|---|---|`);
  for (const [k, r] of Object.entries(out.routes).sort((a, b) => b[1].p95 - a[1].p95).slice(0, 25)) {
    lines.push(`| \`${k}\` | ${r.count} | ${r.p50} | ${r.p95} | ${r.max} | ${JSON.stringify(r.statuses)} |`);
  }
  if (out.notes.length) {
    lines.push("", `## Notes`, "");
    for (const n of out.notes) lines.push(`- ${n}`);
  }
  return `${lines.join("\n")}\n`;
}

// ---------- setup ----------
async function rbac(check, as, method, pathName, body, expected = [403]) {
  const res = await call(as, method, pathName, { body, expect: expected, label: `rbac: ${check}` });
  report.rbac.push({ check, expected: expected.join("/"), got: res.status, pass: expected.includes(res.status) });
  return res;
}

async function setup() {
  report.context = "setup";
  let reach = await call(null, "GET", "/health/live", { expect: [200, 404] });
  if (reach.status !== 200) {
    reach = await call(null, "GET", "/api/docs", { expect: [200, 301, 302] });
    if (reach.status === 0) throw new Error(`API not reachable at ${API}`);
    report.notes.push("`/health/live` is not exposed at this origin (404); reachability checked via `/api/docs`.");
  }

  await login("owner", OWNER_USER, OWNER_PASS);
  if (sessions.owner.user?.mustChangePassword) {
    throw new Error("Owner still has mustChangePassword. Log in once in the web app, set a password, then rerun.");
  }
  const factory = await call("owner", "GET", "/factory/me");
  report.factory = factory.body;

  const profile = await call("owner", "GET", "/gst/profile", { soft: true });
  if (!profile.body || !profile.body.gstin) {
    const res = await call("owner", "POST", "/gst/profile", {
      body: { gstin: "08AABCD1234E1Z5", legalName: factory.body?.name ?? "Dry Run Granites", stateCode: "08" },
    });
    report.notes.push(`No GST profile existed; set a dummy one (08AABCD1234E1Z5, Rajasthan) → ${res.status}.`);
  }
  const gstState = profile.body?.gstin?.slice(0, 2) ?? "08";

  // Staff accounts — owner provisions; existing ones get a password reset.
  const existing = await call("owner", "GET", "/admin/users");
  const byName = new Map((Array.isArray(existing.body) ? existing.body : []).map((u) => [u.username, u]));
  const credentials = { api: API, createdAt: new Date().toISOString(), users: [] };
  for (const role of ROLES) {
    const username = `${PREFIX}.${role}`;
    let temp;
    const prov = await call("owner", "POST", "/admin/users", {
      body: { username, name: `Dry Run ${role[0].toUpperCase()}${role.slice(1)}`, role },
    });
    if (prov.body?.password) {
      temp = prov.body.password;
    } else {
      const id = prov.body?.user?.id ?? byName.get(username)?.id;
      if (!id) throw new Error(`cannot provision or find ${username}`);
      if (byName.get(username)?.active === false) {
        const re = await call("owner", "POST", `/admin/users/${id}/reactivate`);
        temp = re.body?.password;
      }
      if (!temp) {
        const reset = await call("owner", "POST", `/admin/users/${id}/reset-password`);
        temp = reset.body?.password;
      }
      if (!temp) throw new Error(`no temporary password for ${username}`);
    }
    await login(role, username, temp);
    const password = strongPassword();
    const changed = await call(role, "POST", "/auth/change-password", {
      body: { currentPassword: temp, newPassword: password },
    });
    if (!changed.ok) throw new Error(`change-password failed for ${username}`);
    sessions[role] = { ...sessions[role], password, token: changed.body.token };
    credentials.users.push({ role, username, password });
  }
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, "dry-run-credentials.json"), JSON.stringify(credentials, null, 2));

  // Role boundaries on live routes.
  report.context = "rbac";
  const today = new Date().toISOString().slice(0, 10);
  await rbac("operator cannot create users", "operator", "POST", "/admin/users", { username: `${PREFIX}.nope1`, role: "operator" });
  await rbac("manager cannot create users (owner only)", "manager", "POST", "/admin/users", { username: `${PREFIX}.nope2`, role: "operator" });
  await rbac("admin cannot create users", "admin", "POST", "/admin/users", { username: `${PREFIX}.nope3`, role: "operator" });
  await rbac("auditor cannot write expenses", "auditor", "POST", "/expenses", { category: "other", amount: 1, expenseDate: today, clientOpId: `${PREFIX}-deny-aud-exp` });
  await rbac("operator cannot create sales orders", "operator", "POST", "/sales-orders", { customerId: "00000000-0000-0000-0000-000000000000", orderDate: today, clientOpId: `${PREFIX}-deny-opr-so`, lines: [] });
  await rbac("accountant cannot receive blocks", "accountant", "POST", "/inventory/raw-blocks", { serialNumber: "X", varietyName: "X", clientOpId: `${PREFIX}-deny-acc-blk` });
  await rbac("inventory cannot write expenses", "inventory", "POST", "/expenses", { category: "other", amount: 1, expenseDate: today });
  await rbac("admin cannot record payments", "admin", "POST", "/invoices/00000000-0000-0000-0000-000000000000/payments", { amount: 1, method: "cash", paidAt: today, clientOpId: `${PREFIX}-deny-adm-pay` });
  await rbac("auditor cannot record payments", "auditor", "POST", "/invoices/00000000-0000-0000-0000-000000000000/payments", { amount: 1, method: "cash", paidAt: today, clientOpId: `${PREFIX}-deny-aud-pay` });
  await rbac("manager cannot open CEO board", "manager", "GET", "/reports/ceo");
  await rbac("accountant cannot open CEO board", "accountant", "GET", "/reports/ceo");
  await rbac("auditor can open CEO board", "auditor", "GET", "/reports/ceo", undefined, [200]);
  await rbac("sales cannot read trial balance", "sales", "GET", "/books/trial-balance");
  await rbac("operator cannot read audit log", "operator", "GET", "/audit");
  await rbac("supervisor cannot import Tally", "supervisor", "POST", "/tally/daybook", { fileName: "x.xml", xml: "<x/>" });
  await rbac("inventory cannot approve opening count", "inventory", "POST", "/inventory/opening/00000000-0000-0000-0000-000000000000/approve");
  await rbac("sales cannot read machines", "sales", "GET", "/machines");
  await rbac("anonymous is rejected", null, "GET", "/factory/me", undefined, [401]);

  // Masters.
  report.context = "masters";
  const machines = await call("supervisor", "GET", "/machines");
  const list = Array.isArray(machines.body) ? machines.body : [];
  const cutting = list.filter((m) => m.machineType === "CUTTING");
  const polishing = list.filter((m) => m.machineType === "POLISHING");
  if (!cutting.length || !polishing.length) throw new Error("Factory needs at least one CUTTING and one POLISHING machine");

  const suppliers = [];
  for (const [name, stateCode] of [["Dry Quarry Jalore", "08"], ["Dry Quarry Khammam", "36"], ["Dry Quarry Krishnagiri", "33"]]) {
    const s = await call("inventory", "POST", "/inventory/suppliers", { body: { name: `${name} ${PREFIX}`, stateCode } });
    if (s.body?.id) suppliers.push(s.body);
  }
  const customers = [];
  for (const [name, stateCode] of [
    ["Dry Buyer Jaipur Traders", gstState],
    ["Dry Buyer Udaipur Marble", gstState],
    ["Dry Buyer Ahmedabad Stone", "24"],
    ["Dry Buyer Delhi Interiors", "07"],
    ["Dry Buyer Mumbai Builders", "27"],
    ["Dry Buyer Bengaluru Projects", "29"],
    ["Dry Buyer Hyderabad Exports", "36"],
    ["Dry Buyer Lucknow Granites", "09"],
  ]) {
    const c = await call("sales", "POST", "/customers", { body: { name: `${name} ${PREFIX}`, stateCode } });
    if (c.body?.id) customers.push(c.body);
  }
  const vehicles = [];
  for (const name of [`${PREFIX.toUpperCase()}-TRUCK-1`, `${PREFIX.toUpperCase()}-TRUCK-2`, `${PREFIX.toUpperCase()}-LOADER`]) {
    const v = await call("accountant", "POST", "/expenses/vehicles", { body: { name } });
    if (v.body?.id) vehicles.push(v.body);
  }
  const workers = [];
  const crew = [
    ["cutter", 900], ["cutter", 900], ["cutter", 850], ["polisher", 800], ["polisher", 800], ["polisher", 750],
    ["helper", 600], ["helper", 600], ["helper", 550], ["driver", 850],
  ];
  for (const [i, [kind, dailyWage]] of crew.entries()) {
    const w = await call("accountant", "POST", "/muster/workers", { body: { name: `Dry ${kind} ${i + 1}`, kind, dailyWage } });
    if (w.body?.id) workers.push(w.body);
  }
  for (const [name, unit, onHand] of [["Diamond segments", "piece", 40], ["Polishing abrasives", "piece", 120], ["Resin", "litre", 200], ["Hydraulic oil", "litre", 80]]) {
    await call("supervisor", "POST", "/consumables", { body: { name: `${name} (${PREFIX})`, unit, onHand } });
  }
  if (!customers.length || !suppliers.length) throw new Error("Could not create suppliers/customers");

  // Opening count if the yard is not live yet (enterer cannot approve; manager approves).
  if (report.factory?.operatingStatus && report.factory.operatingStatus !== "LIVE") {
    report.context = "opening-count";
    const snap = await call("inventory", "POST", "/inventory/opening");
    const snapId = snap.body?.id;
    if (snapId) {
      await call("inventory", "POST", `/inventory/opening/${snapId}/lines`, {
        body: { kind: "RAW_BLOCK", payload: { serialNumber: `${PREFIX}-OPEN-B1`, varietyName: "Steel Grey", weightTons: "19", invoicedAmount: "125000", actualAmountPaid: "125000" } },
      });
      await call("inventory", "POST", `/inventory/opening/${snapId}/lines`, {
        body: { kind: "POLISHED_SLAB", payload: { slabSerial: `${PREFIX}-OPEN-S1`, varietyName: "Steel Grey", lengthFt: "9", widthFt: "5.5", thicknessMm: "18" } },
      });
      await call("inventory", "POST", `/inventory/opening/${snapId}/submit`);
      await rbac("opening enterer cannot approve own count", "inventory", "POST", `/inventory/opening/${snapId}/approve`);
      await call("manager", "POST", `/inventory/opening/${snapId}/approve`);
      const after = await call("owner", "GET", "/factory/me");
      report.notes.push(`Opening count approved by manager; operatingStatus now ${after.body?.operatingStatus}.`);
    }
  }

  return { cutting, polishing, suppliers, customers, vehicles, workers };
}

// ---------- simulation ----------
const VARIETIES = [
  ["Steel Grey", 1.0], ["Black Galaxy", 1.6], ["Tan Brown", 1.25], ["Absolute Black", 1.8], ["Kashmir White", 1.4], ["Rajasthan Pink", 0.85],
];
const stock = []; // polished slabs ready to sell: { id, sqft, variety, mult }
const receivables = []; // { id, amount, paid, credited, due }
const invoicedOrders = []; // { orderId, invoiceId, slabs: [{id, sqft}] }

function workdaysOf(year, month) {
  const days = [];
  const today = new Date();
  const todayKey = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  for (let d = 1; d <= 31; d += 1) {
    const dt = new Date(Date.UTC(year, month, d));
    if (dt.getUTCMonth() !== month) break;
    if (dt.getUTCDay() === 0) continue; // Sundays off
    if (dt.getTime() >= todayKey) break; // never simulate today or the future
    days.push(dt.toISOString().slice(0, 10));
  }
  return days;
}

async function produceBlock(ctx, day, seq, m) {
  const [variety, mult] = pick(VARIETIES);
  const tons = round2(between(17, 23));
  const lengthFt = pick([9, 9.5, 10, 10.5]);
  const widthFt = pick([5, 5.5, 6]);
  const area = round2(lengthFt * widthFt);
  const good = Math.max(10, Math.round((tons * 105 * between(0.86, 0.97)) / area));
  const damaged = intBetween(0, 3);
  const supplier = pick(ctx.suppliers);
  const serial = `${PREFIX.toUpperCase()}${day.replaceAll("-", "")}-${seq}-${ctx.runId}`;
  const taxable = Math.round(tons * between(6000, 7500) * mult);

  const block = await call("inventory", "POST", "/inventory/raw-blocks", {
    body: {
      serialNumber: serial,
      varietyName: variety,
      supplierId: supplier.id,
      quarry: supplier.name,
      weightTons: tons,
      purchaseTaxable: taxable,
      gstRatePct: 5,
      supplierInvoiceNo: `SUP-${serial}`,
      actualAmountPaid: Math.round(taxable * 1.05),
      clientOpId: `${PREFIX}-blk-${serial}`,
    },
  });
  const blockId = block.body?.block?.id ?? block.body?.id;
  if (!blockId) return;
  m.blocks += 1;
  report.totals.blocks += 1;
  report.totals.tonsReceived += tons;

  const cutter = ctx.cutting[seq % ctx.cutting.length];
  const session = await call("operator", "POST", "/cutting-sessions", {
    body: { rawBlockId: blockId, machineId: cutter.id, expectedSlabCount: good + damaged },
  });
  if (!session.body?.id) return;
  await call("operator", "POST", `/cutting-sessions/${session.body.id}/day-log`, {
    body: { runtimeHours: round2(between(7, 11)), downtimeMinutes: intBetween(0, 90), slabsProducedCount: good + damaged, notes: `sim ${day}` },
  });
  const done = await call("supervisor", "POST", `/cutting-sessions/${session.body.id}/complete`, {
    body: { totalSlabsCut: good + damaged, finalGoodSlabCount: good, lengthFt, widthFt, thicknessMm: pick([16, 18, 20]) },
  });
  const slabs = done.body?.slabs ?? [];
  report.totals.slabsCut += good + damaged;
  report.totals.slabsGood += slabs.length;
  report.totals.sqftProduced += slabs.length * area;
  m.sqftProduced += slabs.length * area;
  if (!slabs.length) return;

  const polisher = ctx.polishing[seq % ctx.polishing.length];
  const polish = await call("operator", "POST", "/polishing-sessions", {
    body: { machineId: polisher.id, processType: "POLISHING", slabIds: slabs.map((s) => s.id), finishType: pick(["mirror", "mirror", "leather", "flamed"]) },
  });
  if (!polish.body?.id) return;
  const finished = await call("supervisor", "POST", `/polishing-sessions/${polish.body.id}/complete`);
  if (!finished.ok) return;
  report.totals.slabsPolished += slabs.length;
  for (const s of slabs) stock.push({ id: s.id, sqft: area, variety, mult });
}

async function sellOrder(ctx, day, m, sqftWanted, orderSeq) {
  const take = [];
  let sqft = 0;
  while (stock.length && sqft < sqftWanted) {
    const slab = stock.shift();
    take.push(slab);
    sqft += slab.sqft;
  }
  if (!take.length) return 0;
  const customer = pick(ctx.customers);
  const cash = rand() < 0.08;
  const opId = `${PREFIX}-so-${day}-${orderSeq}-${ctx.runId}`;
  const lines = take.map((s) => ({ slabId: s.id, quantitySqft: s.sqft, rate: round2(between(70, 110) * s.mult) }));
  const order = await call("sales", "POST", "/sales-orders", {
    body: { customerId: customer.id, orderDate: day, clientOpId: opId, billingMode: cash ? "cash_unbilled" : "gst_invoice", lines },
  });
  const orderId = order.body?.id;
  if (!orderId) return 0;
  report.totals.orders += 1;
  const ids = take.map((s) => s.id);
  await call("sales", "POST", `/sales-orders/${orderId}/packing`, { body: { slabIds: ids } });
  await call("sales", "POST", `/sales-orders/${orderId}/dispatch`, {
    body: { slabIds: ids, clientOpId: `${opId}-disp`, vehicleId: pick(ctx.vehicles)?.id },
  });
  const taxable = lines.reduce((s, l) => s + l.quantitySqft * l.rate, 0);

  if (cash) {
    const amount = round2(taxable);
    const sale = await call("accountant", "POST", `/sales-orders/${orderId}/cash-sale`, {
      body: { amount, saleDate: day, clientOpId: `${opId}-cash`, buyerName: "Walk-in", note: "counter sale" },
    });
    if (sale.ok) {
      report.totals.cashSales += 1;
      report.totals.cashSaleAmount += amount;
    }
  } else {
    const charges = rand() < 0.3 ? [{ label: "Loading", amount: intBetween(800, 2500) }] : [];
    if (rand() < 0.1) charges.push({ label: "Transit insurance", amount: intBetween(300, 900), taxable: false });
    const inv = await call("sales", "POST", `/sales-orders/${orderId}/invoice`, {
      body: { clientOpId: `${opId}-inv`, charges, gstRatePct: 18 },
    });
    const invoiceId = inv.body?.id;
    if (invoiceId) {
      const amount = Number(inv.body.amount);
      m.invoices += 1;
      report.totals.invoices += 1;
      report.totals.invoicedAmount += amount;
      const rec = { id: invoiceId, amount, paid: 0, credited: 0, day };
      receivables.push(rec);
      invoicedOrders.push({ orderId, invoiceId, slabs: take });
      // Collection pattern: 55% pay in full on the day, 30% advance half, 15% on credit.
      const r = rand();
      if (r < 0.55) await collect(rec, rec.amount, day, pick(["neft", "rtgs", "upi", "cheque"]));
      else if (r < 0.85) await collect(rec, round2(rec.amount / 2), day, pick(["neft", "upi", "cash"]));
    }
  }
  m.sqftSold += sqft;
  report.totals.sqftSold += sqft;
  return sqft;
}

async function collect(rec, amount, day, method) {
  const due = round2(rec.amount - rec.paid - rec.credited);
  const pay = round2(Math.min(amount, due));
  if (pay <= 0) return;
  const res = await call("accountant", "POST", `/invoices/${rec.id}/payments`, {
    body: { amount: pay, method, paidAt: day, clientOpId: `${PREFIX}-pay-${rec.id}-${rec.paid.toFixed(2)}` },
  });
  if (res.ok) {
    rec.paid = round2(rec.paid + pay);
    report.totals.paymentsReceived += pay;
  }
}

async function dailyBooks(ctx, day, dayIndex) {
  // Attendance by the supervisor for the whole crew.
  for (const w of ctx.workers) {
    const r = rand();
    const status = r < 0.82 ? "present" : r < 0.9 ? "ot" : r < 0.95 ? "half" : "absent";
    const res = await call("supervisor", "POST", "/muster/attendance", {
      body: { workerId: w.id, date: day, status, ...(status === "ot" ? { otHours: intBetween(1, 4) } : {}) },
    });
    if (res.ok) report.totals.attendanceMarks += 1;
  }
  // Machine runtime logs (operator).
  for (const mc of [...ctx.cutting, ...ctx.polishing]) {
    await call("operator", "POST", "/machine-logs", {
      body: { machineId: mc.id, runtimeHours: round2(between(8, 20)), downtimeMinutes: intBetween(0, 120), notes: `sim ${day}` },
    });
  }
  // Daily diesel for the trucks; weekly transport and consumables.
  await expense({ category: "diesel", amount: intBetween(2500, 6000), expenseDate: day, vehicleId: pick(ctx.vehicles)?.id, toWhom: "HP Pump" });
  if (dayIndex % 6 === 0) {
    await expense({ category: "transport", amount: intBetween(8000, 25000), expenseDate: day, toWhom: "Freight agent" });
    const taxableAmount = intBetween(15000, 60000);
    await expense({ category: "consumables", amount: round2(taxableAmount * 1.18), taxableAmount, gstRatePct: 18, expenseDate: day, toWhom: "Tooling supplier" });
  }
  if (dayIndex % 9 === 0) {
    await expense({ category: "vehicle", amount: intBetween(1500, 9000), expenseDate: day, vehicleId: pick(ctx.vehicles)?.id, toWhom: "Garage" });
  }
}

async function expense(body) {
  const res = await call("accountant", "POST", "/expenses", { body: { ...body, clientOpId: `${PREFIX}-exp-${report.totals.expenses}-${body.expenseDate}-${body.category}-${rand().toString(36).slice(2, 8)}` } });
  if (res.ok) {
    report.totals.expenses += 1;
    report.totals.expenseAmount += Number(body.amount);
  }
  return res;
}

async function monthEnd(ctx, year, month, days, m) {
  const ym = `${year}-${String(month + 1).padStart(2, "0")}`;
  const first = days[0];
  const last = days.at(-1);
  report.context = `${ym} month-end`;

  await expense({ category: "electricity", amount: intBetween(350000, 480000), expenseDate: last, toWhom: "DISCOM" });

  // Maintenance per machine: supervisor schedules, operator closes.
  for (const mc of [...ctx.cutting, ...ctx.polishing]) {
    const job = await call("supervisor", "POST", "/maintenance", { body: { machineId: mc.id, title: `Monthly service ${ym}`, dueOn: last } });
    if (job.body?.id) await call("operator", "POST", `/maintenance/${job.body.id}/complete`);
  }
  await expense({ category: "maintenance", amount: intBetween(20000, 70000), expenseDate: last, toWhom: "Service engineer" });

  // Collections on older credit: invoices more than ~25 days old get paid, 4% stay doubtful.
  const cutoff = new Date(`${last}T00:00:00Z`).getTime() - 25 * 86400000;
  for (const rec of receivables) {
    if (rec.paid + rec.credited >= rec.amount - 0.01 || rec.doubtful) continue;
    if (new Date(`${rec.day}T00:00:00Z`).getTime() > cutoff) continue;
    if (rand() < 0.04) {
      rec.doubtful = true;
      continue;
    }
    await collect(rec, rec.amount, last, pick(["neft", "rtgs", "cheque"]));
  }

  // One customer return with a credit note.
  const candidate = invoicedOrders.splice(Math.floor(rand() * invoicedOrders.length), 1)[0];
  if (candidate) {
    const slab = candidate.slabs[0];
    const ret = await call("sales", "POST", `/sales-orders/${candidate.orderId}/returns`, {
      body: { slabIds: [slab.id], reason: "Edge chipped in transit" },
    });
    if (ret.ok) {
      report.totals.returns += 1;
      const rec = receivables.find((r) => r.id === candidate.invoiceId);
      if (rec && ret.body?.creditNote?.amount) rec.credited = round2(rec.credited + Number(ret.body.creditNote.amount));
    }
  }
  invoicedOrders.length = 0;

  // A quotation that never converts.
  if (stock.length) {
    await call("sales", "POST", "/quotations", {
      body: { customerId: pick(ctx.customers).id, lines: [{ slabId: stock.at(-1).id, description: "Kitchen top lot", quantitySqft: stock.at(-1).sqft, rate: 120 }] },
    });
  }

  // Wages: accountant drafts, drafter may not confirm, manager confirms, accountant pays.
  const sheet = await call("accountant", "POST", "/muster/sheets", { body: { periodStart: first, periodEnd: last, clientOpId: `${PREFIX}-wages-${ym}-${ctx.runId}` } });
  if (sheet.body?.id) {
    await rbac(`wage drafter cannot confirm own sheet (${ym})`, "accountant", "POST", `/muster/sheets/${sheet.body.id}/confirm`);
    const ok = await call("manager", "POST", `/muster/sheets/${sheet.body.id}/confirm`);
    if (ok.ok) await call("accountant", "POST", `/muster/sheets/${sheet.body.id}/pay`, { body: { method: "cash" } });
  }

  // Cash drawer: read the day's rokad and lock it at the computed close.
  const rokad = await call("accountant", "GET", `/books/rokad?date=${last}`);
  const close = findNumber(rokad.body, /clos/i);
  if (close != null) await call("accountant", "POST", "/books/rokad/lock", { body: { date: last, countedClose: close }, soft: true });
  else report.warnings.push({ context: report.context, note: "rokad response had no closing figure; lock skipped", sample: trimBody(rokad.body) });

  // Month-end reads by the roles that use them (latency matters as data grows).
  for (const role of ["owner", ...ROLES]) await call(role, "GET", "/reports/dashboard");
  await call("owner", "GET", "/reports/ceo");
  await call("auditor", "GET", "/reports/ceo");
  await call("supervisor", "GET", `/dpr?from=${first}&to=${last}`);
  await call("sales", "GET", "/recovery-ratio");
  await call("accountant", "GET", "/books/trial-balance");
  await call("accountant", "GET", "/books/outstanding");
  await call("accountant", "GET", `/gst/gstr1?month=${ym}`);
  await call("accountant", "GET", `/gst/position?month=${ym}`);
  await call("auditor", "GET", "/reports/export/blocks.csv");
  await call("auditor", "GET", "/reports/export/slabs.csv");
  await call("auditor", "GET", "/audit");
  await call("inventory", "GET", "/inventory/slabs");
  await call("sales", "GET", "/sales-orders");
  await call("accountant", "GET", "/expenses");
  await call("manager", "GET", "/muster/sheets");
  void m;
}

function findNumber(obj, keyPattern, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 3) return null;
  for (const [k, v] of Object.entries(obj)) {
    if (keyPattern.test(k) && v != null && Number.isFinite(Number(v))) return Number(v);
  }
  for (const v of Object.values(obj)) {
    const found = findNumber(v, keyPattern, depth + 1);
    if (found != null) return found;
  }
  return null;
}

async function main() {
  const ctx = await setup();
  ctx.runId = Date.now().toString(36).slice(-5);

  const now = new Date();
  let [y, mo] = process.env.START_MONTH
    ? process.env.START_MONTH.split("-").map(Number)
    : [now.getUTCFullYear(), now.getUTCMonth() + 1 - 12];
  let cursor = new Date(Date.UTC(y, mo - 1, 1));

  for (let i = 0; i < MONTHS; i += 1) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth();
    const ym = `${year}-${String(month + 1).padStart(2, "0")}`;
    const days = workdaysOf(year, month);
    if (!days.length) break;
    const failuresBefore = report.failures.length;
    const m = { month: ym, workdays: days.length, blocks: 0, sqftProduced: 0, sqftSold: 0, invoices: 0, failures: 0 };
    const monthTarget = between(90000, 100000);
    const t0 = Date.now();

    for (const [di, day] of days.entries()) {
      report.context = day;
      const nBlocks = di % 2 === 0 ? 2 : 3;
      for (let b = 0; b < nBlocks; b += 1) await produceBlock(ctx, day, b + 1, m);

      const remainingDays = days.length - di;
      let todayTarget = Math.max(0, (monthTarget - m.sqftSold) / remainingDays);
      let orderSeq = 0;
      while (todayTarget > 100 && stock.length) {
        const truck = between(900, 1500);
        const sold = await sellOrder(ctx, day, m, Math.min(truck, todayTarget), orderSeq++);
        if (!sold) break;
        todayTarget -= sold;
      }
      await dailyBooks(ctx, day, di);
      process.stdout.write(`\r${day}  blocks ${report.totals.blocks}  produced ${Math.round(report.totals.sqftProduced)} sqft  sold ${Math.round(report.totals.sqftSold)} sqft  stock ${stock.length}  failures ${report.failures.length}   `);
    }

    await monthEnd(ctx, year, month, days, m);
    m.failures = report.failures.length - failuresBefore;
    m.minutes = round2((Date.now() - t0) / 60000);
    report.months.push(m);
    await writeReport();
    console.log(`\n${ym}: ${m.blocks} blocks, ${Math.round(m.sqftProduced)} sqft produced, ${Math.round(m.sqftSold)} sqft sold, ${m.invoices} invoices, ${m.failures} failures, ${m.minutes} min`);
    cursor = new Date(Date.UTC(year, month + 1, 1));
  }

  report.context = "wrap-up";
  await call("manager", "POST", "/tally/daybook", {
    body: { fileName: `${PREFIX}-daybook.xml`, xml: "<ENVELOPE><BODY><VOUCHER><LEDGERNAME>Diesel</LEDGERNAME></VOUCHER></BODY></ENVELOPE>" },
  });
  await call("supervisor", "POST", "/files", {
    body: { fileName: `${PREFIX}-note.txt`, contentType: "text/plain", base64: Buffer.from("volume run").toString("base64") },
  });
  report.notes.push(
    "Cutting, polishing, dispatch, invoice and block-receipt timestamps are always server-now (the API takes no date), so all production and invoice dates land on the run date; only order, payment, expense, attendance and wage dates follow the simulated calendar.",
  );
  report.finishedAt = new Date().toISOString();
  await writeReport();
  console.log(`\nDone. ${report.requestCount} requests, ${report.failures.length} unexpected failures.`);
  console.log(`Report: ${path.join(OUT_DIR, "volume-run-report.md")}`);
  console.log(`Staff logins: ${path.join(OUT_DIR, "dry-run-credentials.json")}`);
}

main().catch(async (error) => {
  report.aborted = String(error?.message ?? error);
  report.finishedAt = new Date().toISOString();
  await writeReport().catch(() => {});
  console.error(`\nAborted: ${report.aborted}`);
  console.error(`Partial report: ${path.join(OUT_DIR, "volume-run-report.md")}`);
  process.exit(1);
});
