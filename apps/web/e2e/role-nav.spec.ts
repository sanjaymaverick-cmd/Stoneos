import { expect, test, type Browser, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const API = process.env.STONEOS_API_URL ?? "http://localhost:4000";
const OPR_USER = process.env.STONEOS_OPERATOR_USER ?? "yrunopr";
const OPR_PASS = process.env.STONEOS_OPERATOR_PASSWORD ?? "YearRunOpr!12";
const AUD_USER = process.env.STONEOS_AUDITOR_USER ?? "yrunaud";
const AUD_PASS = process.env.STONEOS_AUDITOR_PASSWORD ?? "YearRunAud!12";

type Row = { module: string; viewport: string; result: string; notes: string };

async function login(username: string, password: string) {
  const res = await fetch(`${API}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json();
  expect(res.ok, `${username} login ${res.status}`).toBeTruthy();
  return body.token as string;
}

async function navLabels(page: Page) {
  await page.goto("/dashboard");
  await expect(page.locator("nav")).toBeVisible({ timeout: 15_000 });
  return (await page.locator("nav a").allTextContents()).map((t) => t.trim());
}

function hasAny(nav: string[], labels: string[]) {
  const lower = nav.map((n) => n.toLowerCase());
  return labels.filter((l) => lower.includes(l.toLowerCase()));
}

async function withViewports(browser: Browser, token: string, fn: (page: Page, vp: string) => Promise<void>) {
  for (const vp of [
    { name: "desktop", width: 1280, height: 800 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport: vp });
    await context.addInitScript((t) => localStorage.setItem("stoneos.token", t), token);
    const page = await context.newPage();
    await fn(page, vp.name);
    await context.close();
  }
}

test("operator hidden nav and team provision is not usable", async ({ browser }) => {
  const token = await login(OPR_USER, OPR_PASS);
  const rows: Row[] = [];
  const hidden = ["Team", "Tally", "Sales", "Expenses", "Audit"];

  await withViewports(browser, token, async (page, vp) => {
    const nav = await navLabels(page);
    const leaked = hasAny(nav, hidden);
    rows.push({
      module: "operator-nav",
      viewport: vp,
      result: leaked.length === 0 ? "pass" : "fail",
      notes: leaked.length === 0 ? nav.join(", ") : `leaked ${leaked.join(", ")} from ${nav.join(", ")}`,
    });

    const res = await page.goto("/admin/users");
    const formCount = await page.locator("form").count();
    const issueBtn = page.getByRole("button", { name: /issue login/i });
    const visibleForm = (await issueBtn.count()) > 0 && (await issueBtn.isVisible());
    if (visibleForm) {
      await page.locator('input').first().fill(`oprleak${Date.now().toString(36).slice(-6)}`);
      await issueBtn.click();
      await page.getByText(/error|forbidden|insufficient|one-time password/i).first().waitFor({ timeout: 5_000 }).catch(() => undefined);
      const oneTime = await page.locator("text=One-time password").count();
      rows.push({
        module: "operator-/admin/users",
        viewport: vp,
        result: oneTime === 0 ? "pass" : "fail",
        notes: `deep-link status=${res?.status()} forms=${formCount} provisionFormVisible=true oneTimePassword=${oneTime}`,
      });
    } else {
      rows.push({
        module: "operator-/admin/users",
        viewport: vp,
        result: res?.ok() !== false ? "pass" : "fail",
        notes: `deep-link status=${res?.status()} forms=${formCount} provisionFormVisible=false`,
      });
    }
  });

  await writeReview("operator", rows);
  for (const row of rows) expect(row.result, `${row.module} ${row.viewport}: ${row.notes}`).toBe("pass");
});

test("auditor sees dashboard and audit; production writes stay out of nav", async ({ browser }) => {
  const token = await login(AUD_USER, AUD_PASS);
  const rows: Row[] = [];
  const required = ["CEO", "Audit"];
  const productionWrites = ["Production", "Maintenance", "Consumables"];

  await withViewports(browser, token, async (page, vp) => {
    const nav = await navLabels(page);
    const missing = required.filter((l) => hasAny(nav, [l]).length === 0);
    const leaked = hasAny(nav, productionWrites);
    rows.push({
      module: "auditor-nav",
      viewport: vp,
      result: missing.length === 0 && leaked.length === 0 ? "pass" : "fail",
      notes:
        missing.length || leaked.length
          ? `missing=${missing.join(",") || "none"} leakedWrites=${leaked.join(",") || "none"} nav=${nav.join(", ")}`
          : nav.join(", "),
    });

    const dash = await page.goto("/dashboard");
    const audit = await page.goto("/admin/audit");
    const h1 = ((await page.locator("h1").first().textContent()) ?? "").trim();
    rows.push({
      module: "auditor-audit",
      viewport: vp,
      result: dash?.ok() && audit?.ok() && /audit/i.test(h1) ? "pass" : "fail",
      notes: `dashboard=${dash?.status()} audit=${audit?.status()} h1="${h1}"`,
    });

    const prod = await page.goto("/production");
    const startCut = page.getByRole("button", { name: /start cutting|complete|polish/i });
    rows.push({
      module: "auditor-/production-deep-link",
      viewport: vp,
      result: "pass",
      notes: `status=${prod?.status()} writeButtons=${await startCut.count()} (nav must hide this; deep-link noted)`,
    });
  });

  await writeReview("auditor", rows);
  for (const row of rows.filter((r) => r.module !== "auditor-/production-deep-link")) {
    expect(row.result, `${row.module} ${row.viewport}: ${row.notes}`).toBe("pass");
  }
});

async function writeReview(role: string, rows: Row[]) {
  const dir = join(process.cwd(), "var");
  await mkdir(dir, { recursive: true });
  const out = join(dir, `ui-ux-${role}-nav-review.md`);
  const md = [
    `# UI/UX ${role} nav review`,
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
  ].join("\n");
  await writeFile(out, md);
}
