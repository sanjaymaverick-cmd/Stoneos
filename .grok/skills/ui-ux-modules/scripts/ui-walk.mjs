#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const API = process.env.STONEOS_API_URL ?? "http://localhost:4000";
const USER = process.env.STONEOS_OWNER_USER ?? "owner";
const PASS = process.env.STONEOS_OWNER_PASSWORD ?? "YearRunOwner!12";

const ownerRoutes = [
  "/dashboard",
  "/inventory",
  "/setup/opening-inventory",
  "/production",
  "/maintenance",
  "/consumables",
  "/sales",
  "/recovery-ratio",
  "/expenses",
  "/tally",
  "/files",
  "/admin/users",
  "/admin/audit",
  "/account/password",
];

const viewports = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
];

async function apiLogin(username, password) {
  const res = await fetch(`${API}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`login ${username} ${res.status}`);
  return body.token;
}

async function walkAs(browser, vp, token, routes) {
  const context = await browser.newContext({ viewport: vp });
  const page = await context.newPage();
  page.setDefaultTimeout(12_000);
  const rows = [];
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  const loginH1 = await page.locator("h1").first().textContent();
  rows.push({
    module: "/login",
    viewport: vp.name,
    result: (loginH1 ?? "").includes("StoneOS") ? "pass" : "fail",
    notes: `h1="${(loginH1 ?? "").trim()}"`,
  });
  await page.evaluate((t) => localStorage.setItem("stoneos.token", t), token);
  await page.goto(`${BASE}/dashboard`, { waitUntil: "load", timeout: 15_000 });
  try {
    await page.waitForSelector("nav", { timeout: 8_000 });
  } catch (error) {
    const html = (await page.content()).slice(0, 500);
    rows.push({
      module: "/dashboard",
      viewport: vp.name,
      result: "fail",
      notes: `no nav: ${html.replaceAll("\n", " ")}`,
    });
    await context.close();
    return rows;
  }
  const nav = (await page.locator("nav a").allTextContents()).map((t) => t.trim());
  rows.push({
    module: "nav",
    viewport: vp.name,
    result: nav.length ? "pass" : "fail",
    notes: `links: ${nav.join(", ")}`,
  });
  for (const route of routes) {
    const res = await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(250);
    const heading = await page.locator("h1").first().textContent().catch(() => "");
    const error = await page.locator(".error").first().textContent().catch(() => "");
    const table = await page.locator("table").count();
    const form = await page.locator("form").count();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 24);
    rows.push({
      module: route,
      viewport: vp.name,
      result: res && res.ok() ? "pass" : "fail",
      notes: `h1="${(heading ?? "").trim()}" forms=${form} tables=${table} overflow=${overflow} status=${res?.status()} ${error ? `error=${error}` : ""}`,
    });
  }
  await context.close();
  return rows;
}

async function main() {
  console.log("ui-walk starting", BASE);
  const ownerToken = await apiLogin(USER, PASS);
  let operatorToken = null;
  let auditorToken = null;
  try {
    operatorToken = await apiLogin("yrunopr", "YearRunOpr!12");
    auditorToken = await apiLogin("yrunaud", "YearRunAud!12");
  } catch {
    console.log("staff logins unavailable");
  }
  const browser = await chromium.launch({ headless: true });
  console.log("browser launched");
  const rows = [];
  for (const vp of viewports) {
    rows.push(...(await walkAs(browser, vp, ownerToken, ownerRoutes)));
  }
  if (operatorToken) {
    const op = await walkAs(browser, viewports[0], operatorToken, ["/dashboard", "/production", "/admin/users"]);
    const nav = op.find((r) => r.module === "nav");
    const hidden = ["Team", "Tally", "Sales", "Expenses", "Audit"];
    const leaked = hidden.filter((label) => (nav?.notes ?? "").includes(label));
    rows.push({
      module: "operator-hidden-nav",
      viewport: "desktop",
      result: leaked.length === 0 ? "pass" : "fail",
      notes: leaked.length ? `visible: ${leaked.join(", ")}` : "Team/Tally/Sales/Expenses/Audit hidden",
    });
  }
  if (auditorToken) {
    const aud = await walkAs(browser, viewports[0], auditorToken, ["/dashboard", "/admin/audit", "/production"]);
    const nav = aud.find((r) => r.module === "nav");
    rows.push({
      module: "auditor-nav",
      viewport: "desktop",
      result: (nav?.notes ?? "").includes("Audit") && !(nav?.notes ?? "").includes("Production") ? "pass" : "partial",
      notes: nav?.notes ?? "",
    });
  }
  await browser.close();
  await mkdir("var", { recursive: true });
  const md = [
    "# UI/UX module review",
    "",
    `Origin: ${BASE}`,
    "",
    "| Module | Viewport | Result | Notes |",
    "|---|---|---|---|",
    ...rows.map((r) => `| ${r.module} | ${r.viewport} | ${r.result} | ${r.notes.replaceAll("|", "/")} |`),
    "",
    "## Blockers",
    ...(rows.filter((r) => r.result === "fail").map((r) => `- ${r.module} (${r.viewport}): ${r.notes}`) || ["- none"]),
    rows.some((r) => r.result === "fail") ? "" : "- none",
    "",
    "## Suggestions",
    "- Check 44px nav tap targets on a physical phone.",
    "- Empty tables still show a heading; consider an explicit empty-state sentence on first-run modules.",
  ].join("\n");
  await writeFile("var/ui-ux-module-review.md", md);
  console.log(`wrote var/ui-ux-module-review.md rows=${rows.length} fails=${rows.filter((r) => r.result === "fail").length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
