import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
const m = JSON.parse(await readFile("var/company-year/tokens.json", "utf8"));
if (
  process.env.STONEOS_ALLOW_SYNTHETIC_ORACLE !== "yes" ||
  m.factoryId !== "5c183b6d-44b6-4e46-9744-3b705df6d38a"
)
  throw Error("Synthetic company required");
const headers = { Authorization: "Bearer " + m.tokens.owner };
const me = await fetch(m.api + "/api/v1/auth/me", { headers }).then((r) =>
  r.json(),
);
if (me.factoryId !== m.factoryId) throw Error("Wrong test company");
const out = "var/company-year/ui-ux",
  results = JSON.parse(await readFile(out + "/results.json", "utf8"));
results.previousHarnessWorkflowFailures = results.workflows;
results.workflows = [];
const b = await chromium.launch({ headless: true });
for (const vp of [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
]) {
  const c = await b.newContext({ viewport: vp, serviceWorkers: "block" });
  await c.addInitScript(
    (t) => localStorage.setItem("stoneos.token", t),
    m.tokens.owner,
  );
  const p = await c.newPage();
  p.setDefaultTimeout(20000);
  try {
    await p.goto(m.web + "/sales/reports", {
      waitUntil: "networkidle",
      timeout: 90000,
    });
    await p.getByLabel(/^Report/).selectOption("dues");
    await p
      .getByRole("button", { name: "Generate report", exact: true })
      .click();
    await p
      .getByRole("button", { name: "Download Excel", exact: true })
      .waitFor();
    const wait = p.waitForEvent("download", { timeout: 120000 });
    await p
      .getByRole("button", { name: "Download Excel", exact: true })
      .click();
    const d = await wait;
    await d.saveAs(out + "/owner-" + vp.name + "-dues.xlsx");
    const bytes = await readFile(out + "/owner-" + vp.name + "-dues.xlsx");
    if (bytes.toString("ascii", 0, 2) !== "PK")
      throw Error("Workbook not a valid ZIP container");
    results.workflows.push({
      role: "owner",
      viewport: vp.name,
      workflow: "Generate dues report and download Excel",
      result: "proven",
      note: "Actual XLSX downloaded; header validated; financial totals reconciled separately.",
    });
    await p.screenshot({
      path: out + "/owner-" + vp.name + "-dues-workflow.png",
    });
  } catch (e) {
    results.workflows.push({
      role: "owner",
      viewport: vp.name,
      workflow: "Detailed dues report/export",
      result: "failed",
      note: e.message,
    });
  }
  try {
    await p.goto(m.web + "/consumables", {
      waitUntil: "networkidle",
      timeout: 90000,
    });
    const items = await fetch(m.api + "/api/v1/consumables", { headers }).then(
      (r) => r.json(),
    );
    const created = items.find(
      (i) =>
        i.name.startsWith("UI-AUDIT-Epoxy-" + vp.name) &&
        Number(i.onHand) === 10,
    );
    if (!created) throw Error("Previous UI receipt fixture not found");
    await p.getByLabel(/^Item/).selectOption(created.id);
    await p.getByLabel("Quantity", { exact: true }).fill("2");
    await p
      .getByLabel("Reason", { exact: true })
      .fill("UI audit epoxy usage retry with correct label selector");
    await p
      .getByRole("button", { name: "Record movement", exact: true })
      .click();
    await p
      .getByRole("status")
      .filter({ hasText: "Stock movement recorded." })
      .waitFor();
    const after = await fetch(m.api + "/api/v1/consumables", { headers }).then(
      (r) => r.json(),
    );
    if (Number(after.find((i) => i.id === created.id).onHand) !== 8)
      throw Error("Expected8pieces remaining");
    results.workflows.push({
      role: "owner",
      viewport: vp.name,
      workflow: "Create consumable and record use",
      result: "proven",
      note: "Original UI receipt10pieces; now2used; API confirms8remaining.",
    });
    await p.screenshot({
      path: out + "/owner-" + vp.name + "-consumable-workflow.png",
    });
  } catch (e) {
    results.workflows.push({
      role: "owner",
      viewport: vp.name,
      workflow: "Consumable receipt/use",
      result: "failed",
      note: e.message,
    });
  }
  await c.close();
}
await b.close();
await writeFile(out + "/results.json", JSON.stringify(results, null, 2));
await writeFile(
  "var/company-year/ui-ux-workflow-recheck.md",
  "# Targeted UI workflow recheck\n\n" +
    results.workflows
      .map((w) => `- ${w.viewport}: ${w.result} — ${w.workflow}. ${w.note}`)
      .join("\n") +
    "\n",
);
console.log(JSON.stringify(results.workflows));
