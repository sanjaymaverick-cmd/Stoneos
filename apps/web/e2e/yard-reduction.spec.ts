import { test, expect, type Page } from "@playwright/test";
test.use({ serviceWorkers: "block" });
async function fixtures(page: Page, role = "owner") {
  await page.addInitScript(() =>
    localStorage.setItem("stoneos.token", "fixture"),
  );
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data: Record<string, unknown> = {
      "/api/v1/auth/me": {
        id: "fixture-user",
        username: "owner",
        role,
        factoryId: "fixture-factory",
        active: true,
        mustChangePassword: false,
      },
      "/api/v1/reports/today": {
        collectedMtd: 25000,
        outstandingAr: 750,
        blocksOnHand: 2,
        slabsOnHand: 8,
        maintenanceDue: 1,
        expensesMtd: 1000,
        recoveryRatio: null,
        recoveryBenchmark: 105,
      },
      "/api/v1/inventory/raw-blocks": [
        {
          id: "b1",
          serialNumber: "VG-12",
          varietyName: "Tan Brown",
          currentStatus: "in_stock",
        },
        { id: "bad", serialNumber: "BAD-ZERO", currentStatus: "in_stock" },
      ],
      "/api/v1/inventory/slabs": [
        {
          id: "s1",
          parentBlockId: "b1",
          parentBlock: { serialNumber: "VG-12" },
          slabSerial: "VG-12/10/08",
          varietyName: "Tan Brown",
          lengthFt: 8,
          widthFt: 4,
          thicknessMm: 18,
          finish: "glossy",
          salesStatus: "in_stock",
        },
      ],
      "/api/v1/machines": [{ id: "m1", name: "Saw", machineType: "CUTTING" }],
      "/api/v1/muster/workers": [
        { id: "w1", name: "Ramesh", dailyWageMinor: 80000 },
      ],
      "/api/v1/sales-orders": [
        {
          id: "o1",
          status: "CONFIRMED",
          customer: { name: "Buyer" },
          lines: [{ slabId: "s1" }],
          invoices: [],
          packingLists: [],
        },
        {
          id: "o2",
          status: "DELIVERED",
          customer: { name: "Invoice buyer" },
          lines: [{ slabId: "s2" }],
          invoices: [],
          packingLists: [{ id: "p1" }],
        },
      ],
      "/api/v1/books/outstanding": {
        youllGet: 750,
        youllGive: 1000,
        net: -250,
        parties: [],
      },
      "/api/v1/books/collections-today": { collected: 250 },
    };
    await route.fulfill({ json: data[path] ?? [] });
  });
}
for (const width of [390, 799, 1280])
  test(`five destinations and four Today tiles at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await fixtures(page);
    await page.goto("/dashboard");
    await expect(page.locator("nav > a")).toHaveText([
      "Today",
      "Yard",
      "Cut",
      "Sell",
      "Money",
    ]);
    await expect(page.locator(".metric")).toHaveCount(4);
    await expect(page.getByText("₹750", { exact: true })).toBeVisible();
    await expect(
      page.getByText(/waiting until a block is sold out/),
    ).toBeVisible();
    await expect(page.getByText("Copilot", { exact: true })).toHaveCount(0);
    if (width < 800) {
      const rects = await page
        .locator("nav > a")
        .evaluateAll((links) =>
          links.map((l) => l.getBoundingClientRect().top),
        );
      expect(new Set(rects).size).toBe(1);
      await page.screenshot({
        path: testInfo.outputPath("phone.png"),
        fullPage: true,
      });
    }
  });
test("supervisor cannot use Settings or issue users", async ({ page }) => {
  await fixtures(page, "supervisor");
  await page.goto("/admin/users");
  await expect(page.locator("main p[role=alert]")).toHaveText(
    "This screen is restricted.",
  );
  await expect(page.getByRole("button", { name: "Issue login" })).toHaveCount(
    0,
  );
});
test("Cut has block-first polish and no diagnostic blocks or runtime", async ({
  page,
}) => {
  await fixtures(page);
  await page.goto("/production");
  await expect(
    page.getByRole("heading", { name: "Cut", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("BAD-ZERO")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /runtime/ })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Polish selected" }),
  ).toBeDisabled();
});
test("Yard groups slabs by human block serial", async ({ page }) => {
  await fixtures(page);
  await page.goto("/inventory");
  await expect(
    page.getByRole("heading", { name: "VG-12", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "1 · VG-12 / 08" }),
  ).toBeVisible();
});
test("People attendance has separated bilingual 44px chips", async ({
  page,
}) => {
  await fixtures(page);
  await page.goto("/muster");
  const chips = page.locator(".attendance button");
  await expect(chips).toHaveCount(4);
  expect(
    await chips.evaluateAll((bs) =>
      bs.every((b) => b.getBoundingClientRect().height >= 44),
    ),
  ).toBe(true);
  await expect(chips.first()).toContainText("Present / उपस्थित");
});
test("Sell offers actions for each state", async ({ page }) => {
  await fixtures(page);
  await page.goto("/sales");
  await expect(
    page.getByRole("button", { name: "Pack", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Dispatch", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Invoice", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Save quotation" }),
  ).toHaveCount(0);
});
