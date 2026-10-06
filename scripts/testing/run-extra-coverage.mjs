import { readFile, writeFile } from "node:fs/promises";
import { runCoverageScenarios } from "./coverage-scenarios.mjs";
const dir = "/tmp/stoneos-company-year",
  fixture = JSON.parse(await readFile(dir + "/fixture.json", "utf8")),
  checkpoint = JSON.parse(await readFile(dir + "/checkpoint.json", "utf8"));
if (
  process.env.STONEOS_ALLOW_ORACLE_TEST_COMPANY !== "yes" ||
  fixture.factoryId !== "5c183b6d-44b6-4e46-9744-3b705df6d38a"
)
  throw Error("Explicit test company required");
const report = {
  factoryId: fixture.factoryId,
  events: [],
  checks: [],
  failures: [],
};
const ctx = {
  runId: "oracle-20261005",
  factoryId: fixture.factoryId,
  originalFactoryIds: fixture.originalIds,
  simDate: "2026-09-30",
  operations: checkpoint.operations,
  financeState: checkpoint.finance,
  report,
  check: (name, passed, details) =>
    report.checks.push({ name, passed: Boolean(passed), details }),
};
ctx.request = async (role, method, path, body, options = {}) => {
  const r = await fetch("http://127.0.0.1:4011" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-stoneos-test-date": "2026-09-30",
      Authorization: "Bearer " + checkpoint.tokens[role],
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  const text = await r.text();
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    value = { text };
  }
  const result = { status: r.status, ok: r.ok, body: value };
  report.events.push({
    role,
    method,
    path,
    status: r.status,
    expected: options.expected,
  });
  if (options.expected !== undefined ? r.status !== options.expected : !r.ok) {
    report.failures.push({
      role,
      method,
      path,
      status: r.status,
      message: value?.message,
    });
    throw Error(JSON.stringify(report.failures.at(-1)));
  }
  return result;
};
await runCoverageScenarios(ctx);
await writeFile(dir + "/extra-coverage.json", JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    report.extraCoverage.map((r) => ({
      name: r.name,
      status: r.status,
      message: r.message,
    })),
  ),
);
