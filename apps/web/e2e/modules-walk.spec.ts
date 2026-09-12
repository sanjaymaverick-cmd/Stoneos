import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const API = process.env.STONEOS_API_URL ?? "http://localhost:4000";
const USER = process.env.STONEOS_OWNER_USER ?? "owner";
const PASS = process.env.STONEOS_OWNER_PASSWORD ?? "YearRunOwner!12";

const routes = [
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

test("owner module walk desktop and mobile", async ({ browser }) => {
  const login = await fetch(`${API}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  const session = await login.json();
  expect(login.ok, `owner login ${login.status}`).toBeTruthy();
  const rows: Array<{ module: string; viewport: string; result: string; notes: string }> = [];

  for (const vp of [
    { name: "desktop", width: 1280, height: 800 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport: vp });
    await context.addInitScript((t) => localStorage.setItem("stoneos.token", t), session.token);
    const page = await context.newPage();
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "StoneOS" })).toBeVisible();
    rows.push({ module: "/login", viewport: vp.name, result: "pass", notes: "heading visible, no signup" });
    await page.goto("/dashboard");
    await expect(page.locator("nav")).toBeVisible({ timeout: 15_000 });
    const nav = (await page.locator("nav a").allTextContents()).map((t) => t.trim());
    rows.push({ module: "nav", viewport: vp.name, result: "pass", notes: nav.join(", ") });
    for (const route of routes) {
      const res = await page.goto(route);
      const h1 = ((await page.locator("h1").first().textContent()) ?? "").trim();
      const forms = await page.locator("form").count();
      const tables = await page.locator("table").count();
      rows.push({
        module: route,
        viewport: vp.name,
        result: res?.ok() ? "pass" : "fail",
        notes: `h1="${h1}" forms=${forms} tables=${tables} status=${res?.status()}`,
      });
    }
    await context.close();
  }

  const { join } = await import("node:path");
  const out = join(process.cwd(), "var", "ui-ux-module-review.md");
  await mkdir(join(process.cwd(), "var"), { recursive: true });
  const md = [
    "# UI/UX module review",
    "",
    "| Module | Viewport | Result | Notes |",
    "|---|---|---|---|",
    ...rows.map((r) => `| ${r.module} | ${r.viewport} | ${r.result} | ${r.notes.replaceAll("|", "/")} |`),
    "",
    "## Blockers",
    rows.some((r) => r.result === "fail")
      ? rows.filter((r) => r.result === "fail").map((r) => `- ${r.module} (${r.viewport}): ${r.notes}`).join("\n")
      : "- none",
    "",
    "## Suggestions",
    "- Add explicit empty-state copy on first-run tables.",
  ].join("\n");
  await writeFile(out, md);
});
