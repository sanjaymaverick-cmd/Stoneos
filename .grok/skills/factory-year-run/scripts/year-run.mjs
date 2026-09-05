#!/usr/bin/env node
/**
 * 12-month dry company run against a live StoneOS API + Postgres.
 * Usage: node .grok/skills/factory-year-run/scripts/year-run.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const API = process.env.STONEOS_API_URL ?? "http://localhost:4000";
const OWNER_USER = process.env.STONEOS_OWNER_USER ?? "owner";
const OWNER_PASS_IN = process.env.STONEOS_OWNER_PASSWORD ?? "ChangeMeNow!12";
const OWNER_PASS_STABLE = "YearRunOwner!12";
const STAFF = [
  { username: "yrunmgr", role: "manager", name: "Year Manager", password: "YearRunMgr!12" },
  { username: "yrunadm", role: "admin", name: "Year Admin", password: "YearRunAdm!12" },
  { username: "yrunsup", role: "supervisor", name: "Year Supervisor", password: "YearRunSup!12" },
  { username: "yrunopr", role: "operator", name: "Year Operator", password: "YearRunOpr!12" },
  { username: "yruninv", role: "inventory", name: "Year Inventory", password: "YearRunInv!12" },
  { username: "yrunsls", role: "sales", name: "Year Sales", password: "YearRunSls!12" },
  { username: "yrunacc", role: "accountant", name: "Year Accountant", password: "YearRunAcc!12" },
  { username: "yrunaud", role: "auditor", name: "Year Auditor", password: "YearRunAud!12" },
];

const report = { api: API, startedAt: new Date().toISOString(), events: [], failures: [], months: [] };
let ownerPassword = OWNER_PASS_IN;

async function req(method, pathName, { token, body, expected } = {}) {
  const res = await fetch(`${API}${pathName}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  const event = { method, path: pathName, status: res.status, ok: res.ok };
  report.events.push(event);
  if (expected !== undefined && res.status !== expected) {
    report.failures.push({ ...event, expected, body: json });
  }
  return { status: res.status, ok: res.ok, body: json };
}

async function login(username, password) {
  const { ok, body, status } = await req("POST", "/api/v1/auth/login", {
    body: { username, password },
    expected: 200,
  });
  if (!ok) throw new Error(`login failed for ${username}: ${status} ${JSON.stringify(body)}`);
  return body;
}

async function ensurePassword(token, current, next) {
  const mine = await req("GET", "/api/v1/auth/me", { token });
  if (!mine.body?.mustChangePassword) return { token, password: current };
  const changed = await req("POST", "/api/v1/auth/change-password", {
    token,
    body: { currentPassword: current, newPassword: next },
    expected: 200,
  });
  if (!changed.ok) throw new Error(`change-password failed: ${JSON.stringify(changed.body)}`);
  return { token: changed.body.token, password: next };
}

async function main() {
  const live = await req("GET", "/health/live", { expected: 200 });
  const ready = await req("GET", "/health/ready", { expected: 200 });
  if (!live.ok || !ready.ok) {
    throw new Error("API is not ready. Start the local stack first.");
  }

  let owner = await login(OWNER_USER, ownerPassword);
  if (owner.user.mustChangePassword) {
    const updated = await ensurePassword(owner.token, ownerPassword, OWNER_PASS_STABLE);
    owner = { ...owner, token: updated.token };
    ownerPassword = updated.password;
    report.ownerPasswordResetTo = OWNER_PASS_STABLE;
  }

  const tokens = { owner: owner.token };
  const factory = await req("GET", "/api/v1/factory/me", { token: tokens.owner });
  report.factory = factory.body;

  for (const staff of STAFF) {
    const provisioned = await req("POST", "/api/v1/admin/users", {
      token: tokens.owner,
      body: { username: staff.username, name: staff.name, role: staff.role },
      expected: 201,
    });
    const temp = provisioned.body?.password;
    if (provisioned.body?.created === false) {
      report.events.push({ note: `${staff.username} already existed` });
      continue;
    }
    if (!temp) {
      report.failures.push({ staff: staff.username, error: "no temp password returned" });
      continue;
    }
    const session = await login(staff.username, temp);
    const settled = await ensurePassword(session.token, temp, staff.password);
    tokens[staff.role] = settled.token;
  }

  const deny = await req("POST", "/api/v1/admin/users", {
    token: tokens.operator,
    body: { username: "shouldfail", name: "Nope", role: "operator" },
    expected: 403,
  });
  report.operatorCannotProvision = deny.status === 403;

  const managerOwner = await req("POST", "/api/v1/admin/users", {
    token: tokens.manager,
    body: { username: "shouldfailowner", name: "Nope", role: "owner" },
    expected: 403,
  });
  report.managerCannotGrantOwner = managerOwner.status === 403;

  const auditorExpense = await req("POST", "/api/v1/expenses", {
    token: tokens.auditor,
    body: {
      category: "other",
      amount: 1,
      expenseDate: new Date().toISOString().slice(0, 10),
      clientOpId: "deny-auditor-expense",
    },
    expected: 403,
  });
  report.auditorCannotWriteExpense = auditorExpense.status === 403;

  const machines = await req("GET", "/api/v1/machines", { token: tokens.operator });
  const cutting = (machines.body ?? []).find((m) => m.machineType === "CUTTING");
  const polishing = (machines.body ?? []).find((m) => m.machineType === "POLISHING");
  const supplier = await req("POST", "/api/v1/inventory/suppliers", {
    token: tokens.inventory,
    body: { name: "Year Run Quarry" },
  });
  const customer = await req("POST", "/api/v1/customers", {
    token: tokens.sales,
    body: { name: "Year Run Buyer" },
  });
  const vehicle = await req("POST", "/api/v1/expenses/vehicles", {
    token: tokens.accountant,
    body: { name: "YR-TRUCK-1" },
  });

  const start = new Date();
  start.setUTCMonth(start.getUTCMonth() - 11);
  start.setUTCDate(1);

  for (let month = 0; month < 12; month += 1) {
    const when = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + month, 12));
    const stamp = when.toISOString().slice(0, 7);
    const serial = `YR${stamp.replace("-", "")}-${String(month + 1).padStart(2, "0")}`;
    const monthReport = { month: stamp, serial, steps: [] };

    const block = await req("POST", "/api/v1/inventory/raw-blocks", {
      token: tokens.inventory,
      body: {
        serialNumber: serial,
        varietyName: "Steel Grey",
        supplierId: supplier.body?.id,
        quarry: "Year Run Pit",
        weightTons: 18 + month,
        invoicedAmount: 120000 + month * 1000,
        actualAmountPaid: 118000 + month * 1000,
        clientOpId: `yr-block-${serial}`,
      },
    });
    monthReport.steps.push({ receiveBlock: block.status });
    const blockId = block.body?.id ?? block.body?.response?.id;

    if (blockId && cutting) {
      const session = await req("POST", "/api/v1/cutting-sessions", {
        token: tokens.operator,
        body: { rawBlockId: blockId, machineId: cutting.id, expectedSlabCount: 8 },
      });
      monthReport.steps.push({ startCutting: session.status });
      if (session.body?.id) {
        await req("POST", `/api/v1/cutting-sessions/${session.body.id}/day-log`, {
          token: tokens.operator,
          body: { runtimeHours: 10, downtimeMinutes: 30, notes: `month ${stamp}` },
        });
        const done = await req("POST", `/api/v1/cutting-sessions/${session.body.id}/complete`, {
          token: tokens.supervisor,
          body: { totalSlabsCut: 8, finalGoodSlabCount: 7, lengthFt: 8, widthFt: 5, thicknessMm: 18 },
        });
        monthReport.steps.push({ completeCutting: done.status });
        const slabIds = (done.body?.slabs ?? []).map((s) => s.id);
        if (slabIds.length && polishing) {
          const polish = await req("POST", "/api/v1/polishing-sessions", {
            token: tokens.operator,
            body: { machineId: polishing.id, processType: "POLISHING", slabIds, finishType: "leather" },
          });
          monthReport.steps.push({ startPolish: polish.status });
          if (polish.body?.id) {
            await req("POST", `/api/v1/polishing-sessions/${polish.body.id}/complete`, {
              token: tokens.supervisor,
            });
          }
          if (customer.body?.id && slabIds[0]) {
            const order = await req("POST", "/api/v1/sales-orders", {
              token: tokens.sales,
              body: {
                customerId: customer.body.id,
                orderDate: when.toISOString().slice(0, 10),
                clientOpId: `yr-order-${serial}`,
                lines: [{ slabId: slabIds[0], quantitySqft: 40, rate: 180 }],
              },
            });
            monthReport.steps.push({ salesOrder: order.status });
            if (order.body?.id) {
              await req("POST", `/api/v1/sales-orders/${order.body.id}/packing`, {
                token: tokens.sales,
                body: { slabIds: [slabIds[0]] },
              });
              await req("POST", `/api/v1/sales-orders/${order.body.id}/dispatch`, {
                token: tokens.sales,
                body: { slabIds: [slabIds[0]] },
              });
              const inv = await req("POST", `/api/v1/sales-orders/${order.body.id}/invoice`, {
                token: tokens.sales,
                body: { clientOpId: `yr-inv-${serial}` },
              });
              monthReport.steps.push({ invoice: inv.status });
              const invoiceId = inv.body?.id ?? inv.body?.invoices?.[0]?.id;
              if (invoiceId) {
                await req("POST", `/api/v1/invoices/${invoiceId}/payments`, {
                  token: tokens.accountant,
                  body: {
                    amount: 7200,
                    method: "neft",
                    paidAt: when.toISOString(),
                    clientOpId: `yr-pay-${serial}`,
                  },
                });
              }
            }
          }
        }
      }
    }

    await req("POST", "/api/v1/expenses", {
      token: tokens.accountant,
      body: {
        category: "diesel",
        amount: 8000 + month * 200,
        expenseDate: when.toISOString().slice(0, 10),
        vehicleId: vehicle.body?.id,
        clientOpId: `yr-exp-${serial}`,
      },
    });

    if (cutting) {
      await req("POST", "/api/v1/maintenance", {
        token: tokens.supervisor,
        body: {
          machineId: cutting.id,
          title: `B-21 monthly ${stamp}`,
          dueOn: when.toISOString().slice(0, 10),
        },
      });
    }

    report.months.push(monthReport);
  }

  await req("POST", "/api/v1/tally/daybook", {
    token: tokens.manager,
    body: {
      fileName: "year-run-daybook.xml",
      xml: "<ENVELOPE><BODY><VOUCHER><LEDGERNAME>Diesel</LEDGERNAME></VOUCHER></BODY></ENVELOPE>",
    },
  });
  await req("POST", "/api/v1/files", {
    token: tokens.supervisor,
    body: {
      fileName: "year-run.txt",
      contentType: "text/plain",
      base64: Buffer.from("year-run").toString("base64"),
    },
  });
  await req("GET", "/api/v1/reports/dashboard", { token: tokens.auditor, expected: 200 });
  await req("GET", "/api/v1/recovery-ratio", { token: tokens.sales, expected: 200 });
  await req("GET", "/api/v1/dpr", { token: tokens.owner, expected: 200 });

  report.finishedAt = new Date().toISOString();
  report.eventCount = report.events.length;
  report.okCount = report.events.filter((e) => e.ok !== false && (e.status === undefined || e.status < 400)).length;
  const outDir = path.resolve("var");
  await mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, "year-run-report.json");
  await writeFile(outFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ outFile, failures: report.failures.length, months: report.months.length, events: report.eventCount }, null, 2));
  if (report.ownerPasswordResetTo) {
    console.log(`Owner password is now ${report.ownerPasswordResetTo}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
