#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";

const API = process.env.STONEOS_API_URL ?? "http://localhost:4000";
const rows = [];

async function req(method, path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { status: res.status, ok: res.ok, body };
}

function rec(control, result, evidence, severity = "") {
  rows.push({ control, result, evidence, severity });
}

async function main() {
  const loginBad = await req("POST", "/api/v1/auth/login", {
    body: { username: "owner", password: "wrong-password" },
  });
  rec("bad password is 401", loginBad.status === 401 ? "pass" : "fail", `POST /api/v1/auth/login ${loginBad.status}`, loginBad.status === 401 ? "" : "high");

  const signup = await req("POST", "/api/v1/auth/signup", {
    body: { username: "x", password: "ChangeMeNow!12" },
  });
  rec("no public signup", signup.status === 404 ? "pass" : "fail", `POST /api/v1/auth/signup ${signup.status}`, signup.status === 404 ? "" : "high");

  const owner = await req("POST", "/api/v1/auth/login", {
    body: { username: "owner", password: process.env.STONEOS_OWNER_PASSWORD ?? "YearRunOwner!12" },
  });
  const op = await req("POST", "/api/v1/auth/login", {
    body: { username: "yrunopr", password: "YearRunOpr!12" },
  });
  const mgr = await req("POST", "/api/v1/auth/login", {
    body: { username: "yrunmgr", password: "YearRunMgr!12" },
  });
  const aud = await req("POST", "/api/v1/auth/login", {
    body: { username: "yrunaud", password: "YearRunAud!12" },
  });

  const opUsers = await req("POST", "/api/v1/admin/users", {
    token: op.body?.token,
    body: { username: "hacker", name: "H", role: "operator" },
  });
  rec("operator cannot provision users", opUsers.status === 403 ? "pass" : "fail", `POST /api/v1/admin/users ${opUsers.status}`, opUsers.status === 403 ? "" : "high");

  const mgrOwner = await req("POST", "/api/v1/admin/users", {
    token: mgr.body?.token,
    body: { username: "fakeowner", name: "F", role: "owner" },
  });
  rec("manager cannot grant owner", mgrOwner.status === 403 ? "pass" : "fail", `POST /api/v1/admin/users role=owner ${mgrOwner.status}`, mgrOwner.status === 403 ? "" : "high");

  await req("POST", "/api/v1/inventory/raw-blocks", {
    token: owner.body?.token,
    body: {
      serialNumber: "SEC-FORGE-1",
      varietyName: "Grey",
      factoryId: "00000000-0000-0000-0000-000000000000",
      clientOpId: "sec-forge-1",
      weightTons: 1,
    },
  });
  const listed = await req("GET", "/api/v1/inventory/raw-blocks", { token: owner.body?.token });
  const found = (listed.body || []).find((b) => b.serialNumber === "SEC-FORGE-1");
  rec(
    "forged factoryId ignored",
    found && found.factoryId === owner.body.user.factoryId ? "pass" : "fail",
    `stored=${found?.factoryId ?? "missing"} session=${owner.body.user.factoryId}`,
    found && found.factoryId === owner.body.user.factoryId ? "" : "high",
  );

  const tempUser = `sectemp${Date.now().toString(36).slice(-6)}`;
  const tmp = await req("POST", "/api/v1/admin/users", {
    token: owner.body?.token,
    body: { username: tempUser, name: "Temp", role: "operator" },
  });
  const tmpLogin = await req("POST", "/api/v1/auth/login", {
    body: { username: tempUser, password: tmp.body?.password },
  });
  const blocked = await req("POST", "/api/v1/inventory/raw-blocks", {
    token: tmpLogin.body?.token,
    body: { serialNumber: "SEC-TEMP", varietyName: "Grey", clientOpId: "sec-temp", weightTons: 1 },
  });
  rec("temp password blocks other writes", blocked.status === 403 ? "pass" : "fail", `POST raw-blocks as temp user ${blocked.status}`, blocked.status === 403 ? "" : "high");

  const changed = await req("POST", "/api/v1/auth/change-password", {
    token: tmpLogin.body?.token,
    body: { currentPassword: tmp.body?.password, newPassword: "YearRunTmp!12" },
  });
  rec("temp user can change password", changed.status === 200 ? "pass" : "fail", `POST change-password ${changed.status}`);

  const noReason = await req("POST", "/api/v1/inventory/movements/00000000-0000-0000-0000-000000000000/reverse", {
    token: owner.body?.token,
    body: { clientOpId: "sec-rev-noreason" },
  });
  rec(
    "reverse requires reason",
    noReason.status === 400 ? "pass" : "fail",
    `POST movements/:id/reverse without reason ${noReason.status}`,
    noReason.status === 400 ? "" : "high",
  );

  const cust = await req("POST", "/api/v1/customers", {
    token: owner.body?.token,
    body: { name: "Sec Overpay Co" },
  });
  const order = await req("POST", "/api/v1/sales-orders", {
    token: owner.body?.token,
    body: {
      customerId: cust.body?.id,
      orderDate: "2026-09-06",
      clientOpId: crypto.randomUUID(),
      lines: [{ quantitySqft: 1, rate: 10 }],
    },
  });
  const inv = await req("POST", `/api/v1/sales-orders/${order.body?.id}/invoice`, {
    token: owner.body?.token,
    body: { clientOpId: crypto.randomUUID() },
  });
  const over = await req("POST", `/api/v1/invoices/${inv.body?.id}/payments`, {
    token: owner.body?.token,
    body: {
      amount: 999,
      method: "cash",
      paidAt: "2026-09-06",
      clientOpId: crypto.randomUUID(),
    },
  });
  rec(
    "pay cannot exceed invoice",
    over.status === 400 ? "pass" : "fail",
    `POST invoices/:id/payments amount=999 status=${over.status} invoice=${inv.status}`,
    over.status === 400 ? "" : "high",
  );

  await req("POST", "/api/v1/auth/logout", { token: owner.body?.token });
  const reuse = await req("GET", "/api/v1/auth/me", { token: owner.body?.token });
  rec("logout revokes session", reuse.status === 401 ? "pass" : "fail", `GET /auth/me after logout ${reuse.status}`, reuse.status === 401 ? "" : "high");

  const dash = await req("GET", "/api/v1/reports/dashboard", { token: aud.body?.token });
  rec("auditor can read dashboard", dash.status === 200 ? "pass" : "fail", `GET dashboard ${dash.status}`);

  const ceoAsOp = await req("GET", "/api/v1/reports/ceo", { token: op.body?.token });
  rec("operator cannot read CEO brief", ceoAsOp.status === 403 ? "pass" : "fail", `GET /reports/ceo as operator ${ceoAsOp.status}`, ceoAsOp.status === 403 ? "" : "high");

  const csvAsOp = await req("GET", "/api/v1/reports/export/blocks.csv", { token: op.body?.token });
  rec("operator cannot export CSV", csvAsOp.status === 403 ? "pass" : "fail", `GET blocks.csv as operator ${csvAsOp.status}`, csvAsOp.status === 403 ? "" : "high");

  const ceoAsAud = await req("GET", "/api/v1/reports/ceo", { token: aud.body?.token });
  rec("auditor can read CEO brief", ceoAsAud.status === 200 ? "pass" : "fail", `GET /reports/ceo as auditor ${ceoAsAud.status}`);

  const exp = await req("POST", "/api/v1/expenses", {
    token: aud.body?.token,
    body: { category: "other", amount: 1, expenseDate: "2026-01-01", clientOpId: "sec-aud-exp" },
  });
  rec("auditor cannot write expenses", exp.status === 403 ? "pass" : "fail", `POST expenses ${exp.status}`, exp.status === 403 ? "" : "high");

  const md = [
    "# Workflow security review",
    "",
    "| Control | Result | Evidence | Severity |",
    "|---|---|---|---|",
    ...rows.map((r) => `| ${r.control} | ${r.result} | ${r.evidence} | ${r.severity} |`),
    "",
  ].join("\n");
  await mkdir("var", { recursive: true });
  await writeFile("var/security-workflow-review.md", md);
  console.log(JSON.stringify(rows, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
