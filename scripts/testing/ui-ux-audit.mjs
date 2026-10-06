import { chromium } from "@playwright/test";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const manifest = process.env.STONEOS_UI_TOKEN_FILE
  ? JSON.parse(await readFile(process.env.STONEOS_UI_TOKEN_FILE, "utf8"))
  : null;
const web = process.env.PLAYWRIGHT_BASE_URL || manifest?.web;
const api = process.env.STONEOS_API_URL || manifest?.api;
const liveSynthetic =
  process.env.STONEOS_ALLOW_SYNTHETIC_ORACLE === "yes" &&
  manifest?.factoryId &&
  web === "https://stoneos.duckdns.org" &&
  api === web;
for (const origin of [web, api]) {
  if (
    !origin ||
    (!liveSynthetic &&
      !["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname))
  )
    throw new Error(
      "UI audit requires loopback URLs or an explicitly authorized synthetic Oracle tenant manifest.",
    );
}
const output = join(process.cwd(), "var/company-year/ui-ux");
await mkdir(output, { recursive: true });
const retryWorkflows = process.env.STONEOS_UI_RETRY_WORKFLOWS === "yes";
const prior = retryWorkflows
  ? JSON.parse(await readFile(join(output, "results.json"), "utf8"))
  : null;
const rows = prior?.rows || [],
  workflows =
    prior?.workflows.filter(
      (w) => w.role !== "owner" || w.result !== "failed",
    ) || [],
  findings = prior?.findings || [];
findings.push({
  priority: "P1",
  role: "all",
  viewport: "both",
  route: "/consumables",
  text: "Source audit: no incoming link from any app/component and no route policy entry. Factory consumable stock cannot be discovered through normal navigation.",
});
findings.push({
  priority: "P2",
  role: "all",
  viewport: "both",
  route: "/recovery-ratio",
  text: "Source audit: route exists but has no incoming app link or role policy entry; task discovery and visual permission coverage need review.",
});
async function discover(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...(await discover(file)));
    else if (entry.name === "page.tsx")
      result.push("/" + relative("apps/web/app", dir).replaceAll("\\", "/"));
  }
  return result;
}
const routes = (await discover("apps/web/app"))
  .filter((r) => r !== "/" && !r.includes("["))
  .sort();
const browser = await chromium.launch({ headless: true });
const clean = (text) =>
  String(text).replaceAll("|", "/").replaceAll("\n", " ").slice(0, 500);
async function snapshot(page) {
  return page.evaluate(() => {
    const visible = (e) =>
      !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
    const controls = [
      ...document.querySelectorAll("input:not([type=hidden]),select,textarea"),
    ].filter(visible);
    const unnamed = controls
      .filter(
        (e) =>
          !e.labels?.length &&
          !e.getAttribute("aria-label") &&
          !e.getAttribute("aria-labelledby"),
      )
      .map((e) => e.name || e.placeholder || e.tagName);
    const small = [...document.querySelectorAll("nav a,nav button,nav summary")]
      .filter(visible)
      .filter((e) => e.getBoundingClientRect().height < 44)
      .map((e) => e.textContent.trim());
    return {
      heading: document.querySelector("h1")?.textContent?.trim() || "",
      bodyOverflow: document.documentElement.scrollWidth > innerWidth + 2,
      width: document.documentElement.scrollWidth,
      controls: controls.length,
      unnamed,
      small,
      tables: document.querySelectorAll("table").length,
      errors: [...document.querySelectorAll(".error,[role=alert]")]
        .filter(visible)
        .map((e) => e.textContent.trim()),
      restricted:
        document
          .querySelector("main")
          ?.textContent?.includes("This screen is restricted.") || false,
      main: document.querySelector("main")?.textContent?.trim().slice(0, 250),
    };
  });
}
try {
  for (const role of retryWorkflows
    ? ["owner"]
    : ["owner", "manager", "supervisor", "operator", "auditor"]) {
    const username = process.env[`STONEOS_${role.toUpperCase()}_USER`];
    const password = process.env[`STONEOS_${role.toUpperCase()}_PASSWORD`];
    let token = manifest?.tokens?.[role];
    if (!token) {
      if (!username || !password)
        throw new Error(`Missing ${role} credentials`);
      const response = await fetch(`${api}/api/v1/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok)
        throw new Error(`${role} login failed: ${response.status}`);
      token = (await response.json()).token;
    }
    const identityResponse = await fetch(`${api}/api/v1/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const identity = await identityResponse.json();
    if (
      !identityResponse.ok ||
      (manifest && identity.factoryId !== manifest.factoryId)
    )
      throw new Error(
        `${role}: tenant identity assertion failed before browser use`,
      );
    if (manifest?.users?.[role] && identity.username !== manifest.users[role])
      throw new Error(`${role}: synthetic username assertion failed`);
    if (identity.role !== role)
      findings.push({
        priority: "P2",
        role,
        viewport: "both",
        route: "/account",
        text: `Persona ${role} executes as persisted role ${identity.role}; this is compatibility coverage, not proof of a separate ${role} permission model.`,
      });
    let partyRoute;
    if (role === "owner") {
      const outstandingResponse = await fetch(
        `${api}/api/v1/books/outstanding`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      if (outstandingResponse.ok) {
        const outstanding = await outstandingResponse.json();
        const party = outstanding.parties?.[0];
        if (party)
          partyRoute = `/books/parties/${encodeURIComponent(party.id)}`;
      }
      if (!partyRoute)
        workflows.push({
          role,
          viewport: "both",
          workflow: "Dynamic party statement route",
          result: "unverified",
          note: "No party available at audit start; run after year-run fixtures.",
        });
    }
    for (const viewport of [
      { name: "desktop", width: 1280, height: 800 },
      { name: "mobile", width: 390, height: 844 },
    ]) {
      const context = await browser.newContext({
        viewport,
        serviceWorkers: "block",
      });
      await context.addInitScript(
        (t) => localStorage.setItem("stoneos.token", t),
        token,
      );
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.setDefaultNavigationTimeout(60000);
      const failures = [];
      page.on("pageerror", (e) => failures.push(e.message));
      const targets = retryWorkflows
        ? []
        : role === "owner"
          ? [...routes, ...(partyRoute ? [partyRoute] : [])]
          : [
              "/dashboard",
              "/production",
              "/maintenance",
              "/consumables",
              "/inventory",
              "/sales",
              "/expenses",
              "/admin/users",
              "/admin/audit",
            ];
      for (const route of targets) {
        const before = failures.length;
        let row;
        try {
          const response = await page.goto(web + route, {
            waitUntil: "networkidle",
            timeout: 60000,
          });
          await page
            .locator("h1,[role=alert]")
            .first()
            .waitFor({ timeout: 15000 });
          const state = await snapshot(page);
          const slug = `${role}-${viewport.name}-${route.replaceAll("/", "_")}`;
          const pageHeight = await page.evaluate(
            () => document.documentElement.scrollHeight,
          );
          await page.screenshot({
            path: join(output, slug + ".png"),
            fullPage: pageHeight < 20000,
          });
          if (pageHeight >= 20000)
            findings.push({
              priority: "P2",
              role,
              viewport: viewport.name,
              route,
              text: `Page height ${pageHeight}px after factory-volume data; screenshot bounded to viewport. Review pagination and work queues.`,
            });
          row = {
            role,
            persistedRole: identity.role,
            viewport: viewport.name,
            route,
            status: response?.status(),
            ...state,
            runtime: failures.slice(before),
            result:
              response?.ok() &&
              !state.bodyOverflow &&
              failures.length === before
                ? state.restricted
                  ? "restricted"
                  : "partial"
                : "failed",
          };
          if (
            ((identity.role === "operator" && route === "/admin/users") ||
              (identity.role === "auditor" && route === "/production")) &&
            !state.restricted
          )
            findings.push({
              priority: "P1",
              role,
              viewport: viewport.name,
              route,
              text: "Role guard expected here but the page is visible; review whether write controls are exposed and verify API rejection independently.",
            });
          if (state.bodyOverflow)
            findings.push({
              priority: "P1",
              role,
              viewport: viewport.name,
              route,
              text: `Body width ${state.width}px exceeds ${viewport.width}px; horizontal scrolling affects the whole screen.`,
            });
          if (state.unnamed.length)
            findings.push({
              priority: "P2",
              role,
              viewport: viewport.name,
              route,
              text: `${state.unnamed.length} visible controls have no associated label: ${state.unnamed.join(", ")}`,
            });
          if (state.small.length)
            findings.push({
              priority: "P2",
              role,
              viewport: viewport.name,
              route,
              text: `Navigation tap targets below 44px: ${state.small.join(", ")}`,
            });
          for (const error of row.runtime)
            findings.push({
              priority: "P1",
              role,
              viewport: viewport.name,
              route,
              text: error,
            });
        } catch (error) {
          row = {
            role,
            viewport: viewport.name,
            route,
            result: "failed",
            errors: [error.message],
          };
        }
        rows.push(row);
        await writeFile(
          join(output, "progress.json"),
          JSON.stringify({ rows, workflows, findings }, null, 2),
        );
        console.log(`${role} ${viewport.name} ${route}: ${row.result}`);
      }
      if (role === "owner") {
        try {
          await page.goto(web + "/sales/reports", { waitUntil: "networkidle" });
          await page.getByLabel(/^Report/).selectOption("dues");
          await page
            .getByRole("button", { name: "Generate report", exact: true })
            .click();
          await page
            .getByRole("button", { name: "Download Excel", exact: true })
            .waitFor();
          const downloadEvent = page.waitForEvent("download");
          await page
            .getByRole("button", { name: "Download Excel", exact: true })
            .click();
          const download = await downloadEvent;
          if (await download.failure())
            throw new Error("Report download failed");
          await download.saveAs(
            join(output, `owner-${viewport.name}-dues.xlsx`),
          );
          await page.screenshot({
            path: join(output, `owner-${viewport.name}-dues-workflow.png`),
            fullPage: false,
          });
          workflows.push({
            role,
            viewport: viewport.name,
            workflow:
              "Generate detailed customer/supplier dues and download Excel",
            result: "proven",
            note: "Actual browser download saved; workbook contents require financial reconciliation by the year-run agent.",
          });
        } catch (error) {
          const visibleErrors = await page
            .locator(".error,[role=alert]")
            .allTextContents()
            .catch(() => []);
          await page
            .screenshot({
              path: join(output, `owner-${viewport.name}-dues-error.png`),
              fullPage: false,
            })
            .catch(() => undefined);
          workflows.push({
            role,
            viewport: viewport.name,
            workflow: "Detailed dues report/export",
            result: "failed",
            note:
              error.message + "; visible errors: " + visibleErrors.join("; "),
          });
        }
      }
      // A complete stock receipt/use workflow, not merely a rendered page.
      if (role === "owner" && process.env.STONEOS_ALLOW_DEMO_WRITES === "yes") {
        try {
          await page.goto(web + "/consumables", { waitUntil: "networkidle" });
          const item = `UI-AUDIT-Epoxy-${viewport.name}-${Date.now()}`;
          await page.getByLabel("Name", { exact: true }).fill(item);
          await page.getByLabel("On hand", { exact: true }).fill("10");
          await page.getByRole("button", { name: "Add", exact: true }).click();
          await page
            .getByRole("status")
            .filter({ hasText: `${item} added.` })
            .waitFor();
          const list = await fetch(api + "/api/v1/consumables", {
            headers: { authorization: `Bearer ${token}` },
          }).then((r) => r.json());
          const created = list.find((i) => i.name === item);
          if (!created) throw new Error("Added stock missing from API");
          await page.getByLabel(/^Item/).selectOption(created.id);
          await page.getByLabel("Quantity", { exact: true }).fill("2");
          await page
            .getByLabel("Reason", { exact: true })
            .fill("UI audit: epoxy used on polishing batch");
          await page
            .getByRole("button", { name: "Record movement", exact: true })
            .click();
          await page
            .getByRole("status")
            .filter({ hasText: "Stock movement recorded." })
            .waitFor();
          const after = await fetch(api + "/api/v1/consumables", {
            headers: { authorization: `Bearer ${token}` },
          }).then((r) => r.json());
          if (Number(after.find((i) => i.id === created.id)?.onHand) !== 8)
            throw new Error("Usage did not reduce stock to 8");
          await page.screenshot({
            path: join(
              output,
              `owner-${viewport.name}-consumable-workflow.png`,
            ),
            fullPage: true,
          });
          workflows.push({
            viewport: viewport.name,
            role,
            workflow:
              "Create consumable, record usage, verify history and remaining stock",
            result: "proven",
            note: "10 pieces created; 2 used; API confirms 8 remaining.",
          });
        } catch (error) {
          workflows.push({
            viewport: viewport.name,
            role,
            workflow: "Consumable receipt/use",
            result: "failed",
            note: error.message,
          });
        }
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  for (const row of rows) {
    if (row.errors?.length && !row.restricted) {
      row.result = "failed";
      const text = `Visible error state: ${row.errors.join("; ")}`;
      if (
        !findings.some(
          (f) =>
            f.role === row.role &&
            f.viewport === row.viewport &&
            f.route === row.route &&
            f.text === text,
        )
      )
        findings.push({
          priority: "P1",
          role: row.role,
          viewport: row.viewport,
          route: row.route,
          text,
        });
    }
  }
  await writeFile(
    join(output, "results.json"),
    JSON.stringify({ routes, rows, workflows, findings }, null, 2),
  );
  const md = [
    "# StoneOS UI/UX agent review",
    "",
    `Company scope: ${manifest ? "explicitly authorized synthetic Oracle factory, independently asserted for each persona" : "isolated local company"}. A partial row proves rendering and measured usability only; it does not claim every workflow passed. Restricted rows confirm the visible route guard, not API security.`,
    "",
    "| Role | Viewport | Route | Result | Evidence |",
    "|---|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| ${r.role}${r.persistedRole && r.persistedRole !== r.role ? ` (stored ${r.persistedRole})` : ""} | ${r.viewport} | ${r.route} | ${r.result} | ${clean(r.heading || r.errors?.join("; ") || "restricted")} |`,
    ),
    "",
    "## Workflow proof",
    "",
    ...workflows.map(
      (w) =>
        `- ${w.role}, ${w.viewport}: ${w.result} — ${w.workflow}. ${w.note}`,
    ),
    "",
    "## Ranked findings",
    "",
    ...findings.map(
      (f) => `- ${f.priority} ${f.role} ${f.viewport} ${f.route}: ${f.text}`,
    ),
    "",
    "## Follow-up hypotheses requiring user observation",
    "",
    "- Granular staff jobs are spread across short names Today / Yard / Cut / Sell / Money and More; test task discovery with someone unfamiliar with StoneOS.",
    "- Confirm daily batch entry remains practical after a full year: individual slab checklists, full registers and unpaginated tables may become costly at factory volume.",
    "- Consumable quantities are separate from purchase bills/dues; test whether users understand which screen records stock versus money.",
    "- Production completion uses shared count inputs (defaults 10 total / 9 good) without area/dimensions/date entry; polishing uses a native multiple select and hardcoded glossy finish, with no grinding selection. Compare this with the B21/LPM daily workflow before classifying the production UX complete.",
    "- Live workflow testing for purchasing, cutting, polishing, sales, payments and payroll must be combined with the year-run agent evidence before marking complete.",
  ];
  await writeFile(
    join(process.cwd(), "var/company-year/ui-ux-module-review.md"),
    md.join("\n"),
  );
}
