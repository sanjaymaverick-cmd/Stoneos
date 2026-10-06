import { readFile, writeFile, mkdir } from "node:fs/promises";
import {
  buildYearPlan,
  setupOperations,
  runOperationsDay,
} from "./operations-scenarios.mjs";
import { createFinanceAgent } from "./finance-scenarios.mjs";
const dir = process.env.STONEOS_TEST_DIR ?? "/tmp/stoneos-company-year",
  fixture = JSON.parse(await readFile(dir + "/fixture.json", "utf8"));
if (
  process.env.STONEOS_ALLOW_ORACLE_TEST_COMPANY !== "yes" ||
  fixture.factoryId !== "5c183b6d-44b6-4e46-9744-3b705df6d38a" ||
  new URL(fixture.api).hostname !== "127.0.0.1"
)
  throw Error("Explicit authorized Oracle test factory required");
fixture.api = "http://127.0.0.1:4011";
await mkdir(dir, { recursive: true });
const runId = "oracle-20261005";
let report = {
    runId,
    factoryId: fixture.factoryId,
    environment: "Oracle synthetic company; existing company excluded",
    startedAt: new Date().toISOString(),
    events: [],
    checks: [],
    months: [],
    failures: [],
    boundaries: [],
  },
  tokens = {},
  saved = {},
  replay = {};
try {
  saved = JSON.parse(await readFile(dir + "/checkpoint.json", "utf8"));
  report = saved.report;
  tokens = saved.tokens;
  replay = JSON.parse(await readFile(dir + "/request-cache.json", "utf8"));
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
let financeBeforeMonth = saved.financeBeforeMonth;
const cache = { ...replay };
let count = 0,
  simDate = "2026-10-05";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, passed, details = {}) => {
  report.checks.push({ name, passed: Boolean(passed), details });
  if (!passed) console.log("CHECK_FAILED " + name);
};
async function request(role, method, path, body, options = {}) {
  if (!path.startsWith("/api/v1/") && !path.startsWith("/health"))
    throw Error("Unexpected path");
  const key = JSON.stringify([role, method, path, body]);
  if (
    method !== "GET" &&
    replay[key] &&
    (options.expected === undefined || replay[key].status === options.expected)
  ) {
    return replay[key];
  }
  if (
    options.expected !== undefined &&
    saved.report &&
    saved.report.events.some(
      (e) =>
        e.role === role &&
        e.method === method &&
        e.path === path &&
        e.expected === options.expected &&
        e.status === options.expected,
    )
  ) {
    return {
      status: options.expected,
      ok: options.expected < 400,
      body: { checkpointEvidence: true },
    };
  }
  let response;
  for (let attempt = 0; attempt < 4; attempt++) {
    response = await fetch(fixture.api + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-stoneos-test-date": String(
          body?.occurredAt ??
            body?.expenseDate ??
            body?.orderDate ??
            body?.purchaseDate ??
            body?.invoiceDate ??
            body?.paidAt ??
            body?.date ??
            simDate,
        ).slice(0, 10),
        ...(tokens[role] ? { Authorization: "Bearer " + tokens[role] } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
    if (response.status !== 429) break;
    await sleep(20000);
  }
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { text, downloadBytes: Buffer.byteLength(text) };
  }
  const result = { status: response.status, ok: response.ok, body: json };
  report.events.push({
    role,
    method,
    path,
    status: result.status,
    expected: options.expected,
    at: new Date().toISOString(),
  });
  count++;
  if (
    (options.expected !== undefined && result.status !== options.expected) ||
    (options.expected === undefined && !result.ok)
  ) {
    const failure = {
      role,
      method,
      path,
      status: result.status,
      expected: options.expected,
      message: json?.message ?? json,
    };
    report.failures.push(failure);
    await writeFile(dir + "/request-cache.json", JSON.stringify(cache));
    throw Error(JSON.stringify(failure));
  }
  if (method !== "GET" && !path.includes("/auth/")) cache[key] = result;
  return result;
}
for (const [role, username] of Object.entries(fixture.users)) {
  if (!tokens[role]) {
    const r = await request(role, "POST", "/api/v1/auth/login", {
      username,
      password: fixture.password,
    });
    tokens[role] = r.body.token;
  }
  const me = await request(role, "GET", "/api/v1/auth/me");
  if (me.body.factoryId !== fixture.factoryId || me.body.username !== username)
    throw Error("Test tenant/session mismatch");
  check("Authenticated test identity " + role, true, {
    persistedRole: role,
    effectiveRole: me.body.role,
  });
}
await writeFile(
  dir + "/tokens.json",
  JSON.stringify(
    {
      factoryId: fixture.factoryId,
      api: "https://stoneos.duckdns.org",
      web: fixture.web,
      tokens,
      users: fixture.users,
      data: "synthetic",
    },
    null,
    2,
  ),
);
const plan = buildYearPlan(),
  ctx = { runId, request, check, report, tokens, plan },
  finance = createFinanceAgent(ctx);
if (saved.operations) {
  ctx.operations = saved.operations;
  ctx.operations.monthsReceived = new Set(saved.operations.monthsReceived);
  Object.assign(finance.state, saved.finance);
  if (financeBeforeMonth)
    Object.assign(finance.state, financeBeforeMonth.state);
  else if (report.months.length === 0 && ctx.operations.days.length > 0) {
    Object.assign(finance.state, {
      stock: [],
      months: [],
      invoices: [],
      firstInvoice: null,
      replayedOrder: false,
      replayedCash: false,
      replayedPayment: false,
      returned: false,
      returnedSqft: 0,
    });
  }
}
async function checkpoint(extra = {}) {
  await writeFile(dir + "/request-cache.json", JSON.stringify(cache));
  await writeFile(
    dir + "/checkpoint.json",
    JSON.stringify({
      report,
      tokens,
      operations: ctx.operations
        ? {
            ...ctx.operations,
            monthsReceived: [...ctx.operations.monthsReceived],
          }
        : undefined,
      finance: finance.state,
      financeBeforeMonth,
      ...extra,
    }),
  );
  await writeFile(
    dir + "/year-run-report.json",
    JSON.stringify(report, null, 2),
  );
}
try {
  if (!saved.operations) {
    await finance.setup();
    await setupOperations(ctx);
    await checkpoint();
    console.log("TEST_AGENTS_READY roles=9 company=" + fixture.factoryId);
  }
  for (const month of plan) {
    if (report.months.some((m) => m.month === month.month && m.complete))
      continue;
    const daily = [];
    for (const day of month.days) {
      simDate = day.date;
      const prior = ctx.operations.days.find((d) => d.date === day.date);
      if (prior) {
        const slabs = Object.entries(cache)
          .filter(([key, value]) => {
            const item = JSON.parse(key);
            return (
              item[1] === "POST" &&
              item[2].includes("/cutting-sessions/") &&
              item[2].endsWith("/complete") &&
              item[3]?.occurredAt?.startsWith(day.date)
            );
          })
          .flatMap(([, value]) => value.body.slabs ?? []);
        if (slabs.length !== 110)
          throw Error("Incomplete saved production for " + day.date);
        daily.push({ slabs, slabIds: slabs.map((s) => s.id), blockIds: [] });
        continue;
      }
      const result = await runOperationsDay(ctx, day);
      daily.push(result);
      await checkpoint();
      if (day.dayIndex % 7 === 0)
        console.log(
          "PROGRESS " +
            day.date +
            " produced=" +
            result.area +
            " requests=" +
            report.events.length,
        );
    }
    simDate = new Date(
      Date.UTC(
        Number(month.month.slice(0, 4)),
        Number(month.month.slice(5, 7)),
        0,
      ),
    )
      .toISOString()
      .slice(0, 10);
    financeBeforeMonth = {
      month: month.month,
      state: structuredClone(finance.state),
    };
    await checkpoint();
    const slabIds = daily.flatMap((d) => d.slabIds ?? d.slabs.map((s) => s.id));
    const sales = await finance.runMonth({
      month: month.month,
      date: month.month + "-25",
      slabIds,
      rawBlockIds: daily.flatMap((d) => d.blockIds ?? []),
      producedSqft: month.area,
      targetSalesSqft: month.salesTargetSqft,
    });
    report.months.push({
      ...sales,
      productionSqft: month.area,
      tons: month.tons,
      days: 22,
      complete: true,
    });
    financeBeforeMonth = undefined;
    await checkpoint();
    console.log(
      "MONTH_COMPLETE " +
        month.month +
        " production=" +
        month.area +
        " sales=" +
        sales.grossSalesSqft,
    );
  }
  simDate = "2026-09-30";
  await finance.finish();
  report.completedAt = new Date().toISOString();
  report.summary = {
    months: report.months.filter((m) => m.complete).length,
    productionSqft: report.months.reduce((n, m) => n + m.productionSqft, 0),
    grossSalesSqft: report.months.reduce((n, m) => n + m.grossSalesSqft, 0),
    tons: report.months.reduce((n, m) => n + m.tons, 0),
    requests: report.events.length,
    failedChecks: report.checks.filter((c) => !c.passed).length,
    unexpectedRequests: report.failures.length,
  };
  await checkpoint();
  console.log("YEAR_RUN_FINISHED " + JSON.stringify(report.summary));
} catch (e) {
  report.stoppedAt = new Date().toISOString();
  report.stopReason = e.message;
  await checkpoint();
  console.error("YEAR_RUN_STOPPED " + e.message);
  process.exitCode = 1;
}
