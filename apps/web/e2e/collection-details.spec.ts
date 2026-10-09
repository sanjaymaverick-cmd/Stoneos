import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });
for (const width of [390, 1280]) {
  test(`clarify pending balances and annotate a receipt at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => localStorage.setItem("stoneos.token", "fixture"));
    let customer = { id: "buyer", name: "Customer A", pendingCash: "0", pendingBank: "0", collectionNote: "", version: 0 };
    let receipt: Record<string, unknown> | undefined;
    await page.route("**/api/v1/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/auth/me")) return route.fulfill({ json: { id: "owner", factoryId: "test", role: "owner", mustChangePassword: false } });
      if (path.endsWith("/customers/buyer")) {
        const body = route.request().postDataJSON();
        expect(body.baseVersion).toBe(0);
        customer = { ...customer, ...body, version: 1 };
        return route.fulfill({ json: customer });
      }
      if (path.endsWith("/customers")) return route.fulfill({ json: [customer] });
      if (path.endsWith("/invoices/invoice/payments")) {
        receipt = route.request().postDataJSON();
        return route.fulfill({ json: { id: "receipt", ...receipt } });
      }
      if (path.endsWith("/sales-orders")) return route.fulfill({ json: [{ id: "order", status: "CONFIRMED", customer: { name: "Customer A" }, lines: [], invoices: [{ id: "invoice", amount: "100000", payments: [], creditNotes: [] }] }] });
      return route.fulfill({ json: [] });
    });
    await page.goto("/sales");
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("Cash pending (₹)", { exact: true }).fill("50000");
    await page.getByLabel("Bank / UPI pending (₹)", { exact: true }).fill("50000");
    await page.getByLabel("Collection note", { exact: true }).fill("Clarified by customer");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByText("Clarified by customer", { exact: true })).toBeVisible();
    await page.getByLabel("Payment amount", { exact: true }).fill("50000");
    await page.getByRole("combobox", { name: "Payment mode" }).selectOption("UPI");
    await page.getByRole("combobox", { name: "Settles pending portion" }).selectOption("cash");
    await page.getByLabel("Received by / account", { exact: true }).fill("Any receiving person");
    await page.getByLabel("Payment reference", { exact: true }).fill("UTR-123");
    await page.getByLabel("Payment note", { exact: true }).fill("PhonePe to receiving person");
    await page.getByRole("button", { name: "Record payment", exact: true }).click();
    await expect.poll(() => receipt).toMatchObject({ amount: 50000, method: "UPI", pendingBucket: "cash", receivedBy: "Any receiving person", reference: "UTR-123", note: "PhonePe to receiving person" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
