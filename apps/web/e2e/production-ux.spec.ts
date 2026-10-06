import { expect, test, type Page } from "@playwright/test";
test.use({ serviceWorkers: "block" });
type Write = { path: string; body: Record<string, unknown> };
async function setup(page: Page, fail = false) {
  const writes: Write[] = []; const queries: string[] = []; let starts = 0, completes = 0;
  await page.addInitScript(() => localStorage.setItem("stoneos.token", "synthetic-test"));
  await page.route("**/api/v1/**", async route => {
    const r = route.request(), u = new URL(r.url()), p = u.pathname;
    if (p.endsWith("/auth/me")) return route.fulfill({ json: { id: "owner", username: "owner", role: "owner", factoryId: "f", mustChangePassword: false } });
    if (r.method() === "POST") {
      writes.push({ path: p, body: r.postDataJSON() });
      if (p === "/api/v1/polishing-sessions") return route.fulfill({ json: { id: `process-${++starts}` } });
      if (p.startsWith("/api/v1/polishing-sessions/")) {
        if (++completes === 1 && fail) return route.fulfill({ status: 400, json: { message: "Fixture completion needs retry" } });
        return route.fulfill({ json: { completed: true } });
      }
      if (p.startsWith("/api/v1/cutting-sessions/") && p.endsWith("/complete")) return route.fulfill({ json: { completed: true } });
      throw new Error(`Unexpected synthetic write: ${p}`);
    }
    if (p.endsWith("/machines")) return route.fulfill({ json: [{ id: "saw", name: "B21", machineType: "CUTTING" }, { id: "lpm", name: "LPM", machineType: "POLISHING" }] });
    if (p.endsWith("/raw-blocks")) return route.fulfill({ json: [1, 2].map(n => ({ id: `block-${n}`, serialNumber: `B21-00${n}`, weightTons: 20, currentStatus: "in_stock" })) });
    if (p.endsWith("/cutting-sessions")) return route.fulfill({ json: [1, 2].map(n => ({ id: `cut-${n}`, status: "IN_PROGRESS", rawBlock: { serialNumber: `B21-00${n}` } })) });
    if (p.endsWith("/slabs")) {
      queries.push(u.search);
      return route.fulfill({ json: { items: [1, 2].map(n => ({ id: `slab-${n}`, slabSerial: `B21-001/2/0${n}`, parentBlockId: "block-1", salesStatus: "in_stock", lengthFt: 8, widthFt: 5 })), total: 2, page: 1, pageSize: 100 } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/production"); await expect(page.getByRole("heading", { name: "Cut", exact: true })).toBeVisible();
  return { writes, queries };
}
async function counts(page: Page) {
  for (const [name, value] of [["Total cut", "56"], ["Good slabs", "55"], ["Length (ft)", "8"], ["Width (ft)", "5"]]) await page.getByLabel(name, { exact: true }).fill(value);
}
test("cutting requires reviewed counts; changing session clears the previous counts", async ({ page }) => {
  const { writes } = await setup(page);
  await page.getByLabel(/^Session(?! date)/).selectOption("cut-1");
  await expect(page.getByLabel("Total cut", { exact: true })).toHaveValue("");
  await counts(page); await page.getByRole("button", { name: "Review cutting completion", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review before saving" })).toBeVisible(); expect(writes).toHaveLength(0);
  await expect(page.getByLabel("Total cut", { exact: true })).toBeDisabled();
  await page.getByLabel(/^Session(?! date)/).selectOption("cut-2");
  await expect(page.getByLabel("Total cut", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Length (ft)", { exact: true })).toHaveValue("");
  await expect(page.getByRole("heading", { name: "Review before saving" })).toHaveCount(0);
  await counts(page); await page.getByRole("button", { name: "Review cutting completion", exact: true }).click();
  await page.getByRole("button", { name: "Confirm cutting completion", exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ path: "/api/v1/cutting-sessions/cut-2/complete", body: { totalSlabsCut: 56, finalGoodSlabCount: 55, lengthFt: 8, widthFt: 5, thicknessMm: 18 } });
  expect(new Date(String(writes[0].body.occurredAt)).getTime()).toBeLessThanOrEqual(Date.now() + 5000);
});
test("mobile checkbox batches use bounded per-block reads and all three process payloads", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const { writes, queries } = await setup(page);
  const batch = page.getByRole("group", { name: "Process batch", exact: true });
  await batch.getByLabel(/^Block(?! date)/).selectOption("block-1"); await expect(batch.getByRole("checkbox")).toHaveCount(2);
  for (const stage of ["GRINDING", "RESIN", "POLISHING"]) {
    await batch.getByLabel(/^Process(?! date)/).selectOption(stage);
    if (stage === "POLISHING") await batch.getByLabel(/^Finish(?! date)/).selectOption("honed");
    await batch.getByRole("checkbox").first().check();
    await expect(batch.getByText(/1 slabs selected/)).toBeVisible(); await expect(batch.getByText(/^40 sq ft selected/)).toBeVisible();
    await page.getByRole("button", { name: /^Record .* for selected slabs$/ }).click();
    await expect(page.getByRole("status").filter({ hasText: /recorded\./ })).toBeVisible();
    await expect(batch.getByRole("checkbox").first()).not.toBeChecked();
  }
  const starts = writes.filter(w => w.path === "/api/v1/polishing-sessions");
  expect(starts.map(w => w.body.processType)).toEqual(["GRINDING", "RESIN", "POLISHING"]);
  for (const w of starts) expect(w.body.slabIds).toEqual(["slab-1"]);
  expect(starts[0].body.finishType).toBeUndefined(); expect(starts[1].body.finishType).toBeUndefined(); expect(starts[2].body.finishType).toBe("honed");
  expect(queries.length).toBeGreaterThan(0);
  for (const q of queries) { expect(new URLSearchParams(q).get("parentBlockId")).toBe("block-1"); expect(new URLSearchParams(q).get("pageSize")).toBe("100"); }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
test("failed process completion reuses the original session on retry", async ({ page }) => {
  const { writes } = await setup(page, true); const batch = page.getByRole("group", { name: "Process batch", exact: true });
  await batch.getByLabel(/^Block(?! date)/).selectOption("block-1"); await batch.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: /^Record grinding/ }).click();
  await expect(page.getByText("Fixture completion needs retry", { exact: true })).toBeVisible();
  await expect(batch.getByLabel(/^Process(?! date)/)).toBeDisabled();
  await page.getByRole("button", { name: /^Retry completion:/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Grinding recorded." })).toBeVisible();
  expect(writes.filter(w => w.path === "/api/v1/polishing-sessions")).toHaveLength(1);
  expect(writes.filter(w => w.path.endsWith("/complete")).map(w => w.path)).toEqual(["/api/v1/polishing-sessions/process-1/complete", "/api/v1/polishing-sessions/process-1/complete"]);
});
