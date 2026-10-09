import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });
for (const width of [390, 1280]) {
  test(`dated invoice-free opening and annotated collection at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => localStorage.setItem("stoneos.token", "fixture"));
    let actor = "enterer";
    let batch: any = null;
    await page.route("**/api/v1/**", async route => {
      const path = new URL(route.request().url()).pathname;
      const method = route.request().method();
      if (path.endsWith("/auth/me")) return route.fulfill({ json: { id: actor, factoryId: "factory", role: "owner", mustChangePassword: false } });
      if (path.endsWith("/books/openings") && method === "GET") return route.fulfill({ json: batch ? [batch] : [] });
      if (path.endsWith("/books/openings") && method === "POST") {
        const body = route.request().postDataJSON();
        expect(body.effectiveDate).toBe("2026-10-01");
        batch = { ...body, id: "batch", status: "DRAFT", enteredByIds: [actor], version: 0, lines: body.lines.map((payload: any, i: number) => ({ id: `line-${i}`, kind: payload.kind, ref: payload.ref, payload, amount: String(payload.amount), settledAmount: "0", settlements: [] })) };
        return route.fulfill({ json: batch });
      }
      if (path.endsWith("/batch/submit")) { batch.status = "SUBMITTED"; batch.version++; return route.fulfill({ json: batch }); }
      if (path.endsWith("/batch/approve")) {
        expect(actor).toBe("approver");
        expect(route.request().postDataJSON().reconciled).toBe(true);
        batch.status = "APPROVED"; batch.version++;
        return route.fulfill({ json: batch });
      }
      if (path.endsWith("/line-0/settlements")) {
        const body = route.request().postDataJSON();
        expect(body).toMatchObject({ amount: 50000, method: "UPI", pendingBucket: "cash", receivedBy: "Any person", note: "PhonePe received on our behalf", reference: "OPEN-UTR" });
        const receipt = { ...body, id: "receipt" };
        batch.lines[0].settledAmount = "50000"; batch.lines[0].settlements = [receipt];
        return route.fulfill({ json: receipt });
      }
      return route.fulfill({ json: [] });
    });
    await page.goto("/books/openings");
    await page.getByLabel("Effective opening date", { exact: true }).fill("2026-10-01");
    await page.getByLabel("Name / variety", { exact: true }).fill("Customer A");
    await page.getByLabel("Customer owes (₹)", { exact: true }).fill("100000");
    await page.getByLabel("Cash pending (₹)", { exact: true }).fill("50000");
    await page.getByLabel("Bank / UPI pending (₹)", { exact: true }).fill("50000");
    await page.getByLabel("Source reference", { exact: true }).fill("September closing sheet");
    await page.getByRole("button", { name: "Add line", exact: true }).click();
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await page.getByRole("button", { name: "Submit for approval", exact: true }).click();
    await expect(page.getByRole("button", { name: "Approve opening balances", exact: true })).toBeDisabled();
    actor = "approver";
    await page.reload();
    await page.getByRole("combobox", { name: "Opening batch" }).selectOption("batch");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Approve opening balances", exact: true }).click();
    await page.getByLabel("Amount received (₹)", { exact: true }).fill("50000");
    await page.getByRole("combobox", { name: "Actual payment mode" }).selectOption("UPI");
    await page.getByRole("combobox", { name: "Settles pending portion" }).selectOption("cash");
    await page.getByLabel("Received by / paid to", { exact: true }).fill("Any person");
    await page.getByLabel("Transaction reference", { exact: true }).fill("OPEN-UTR");
    await page.getByLabel("Transaction note", { exact: true }).fill("PhonePe received on our behalf");
    await page.getByRole("button", { name: "Record opening collection", exact: true }).click();
    await expect(page.getByRole("region", { name: "Settlements for Customer A" })).toContainText("PhonePe received on our behalf");
    await expect(page.getByText("Remaining", { exact: false })).toContainText("50,000");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
