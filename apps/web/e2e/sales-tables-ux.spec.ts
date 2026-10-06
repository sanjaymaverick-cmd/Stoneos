import { expect, test, type Locator, type Page } from "@playwright/test";

/*
 * Wide sales tables on a phone.
 *
 * Customers (/sales) and the lot sale basket and invoice (/lots/sell) each hold a
 * table wider than a 360px screen. The page itself must never scroll sideways;
 * the table sits in a named region that scrolls on its own, takes keyboard focus,
 * and moves with the arrow keys. Mocked API: this proves layout and keyboard
 * behaviour, not live data.
 */

test.use({ serviceWorkers: "block" });

const OWNER = { id: "owner", factoryId: "test", username: "owner", role: "owner", active: true, mustChangePassword: false };

const CUSTOMERS = [
  {
    id: "c1",
    name: "Shri Ganesh Marble and Granite Traders Private Limited",
    gstin: "08AABCS1234K1Z5",
    stateCode: "08",
    billingAddress: "Plot 14, RIICO Industrial Area, Kishangarh, Ajmer, Rajasthan 305801",
  },
  { id: "c2", name: "Walk-in buyer", gstin: null, stateCode: null, billingAddress: null },
];

const LOTS = {
  lots: [
    { blockId: "b1", blockSerial: "VG-101", label: "VG-101-70", variety: "Kotda black", availableSlabs: 70, polishedSlabCount: 70, sqftPerSlab: 49.5 },
  ],
};

const ORDER = {
  orderId: "o1",
  customer: CUSTOMERS[0]!.name,
  taxableAmount: 294525,
  billingMode: "gst_invoice",
  cashAmount: 0,
  lines: [{ blockSerial: "VG-101", slabCount: 70 }],
};

const BILL = {
  invoiceNumber: "INV-2026-00042",
  invoiceDate: "2026-10-06",
  seller: { legalName: "Vedam Granites", gstin: "08AAUFV3603N1ZH", stateCode: "08" },
  billTo: { name: CUSTOMERS[0]!.name, address: CUSTOMERS[0]!.billingAddress, gstin: CUSTOMERS[0]!.gstin, stateCode: "08" },
  shipTo: { name: null, address: null, gstin: null, stateCode: null },
  placeOfSupply: "08",
  interState: false,
  items: [
    { blockSerial: "VG-101", description: "Kotda black polished slabs, 18 mm", hsnCode: "6802", slabCount: 70, quantitySqft: 3465, rate: 85, gstRatePct: 18, amount: 294525 },
  ],
  hsnSummary: [
    { hsnCode: "6802", gstRatePct: 18, taxableAmount: 294525, cgstAmount: 26507.25, sgstAmount: 26507.25, igstAmount: 0 },
  ],
  totals: { taxableAmount: 294525, cgstAmount: 26507.25, sgstAmount: 26507.25, igstAmount: 0, payable: 347539.5 },
};

async function mockApi(page: Page) {
  await page.addInitScript(() => localStorage.setItem("stoneos.token", "fixture"));
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const post = route.request().method() === "POST";
    if (path.endsWith("/auth/me")) return route.fulfill({ json: OWNER });
    if (path.endsWith("/customers")) return route.fulfill({ json: CUSTOMERS });
    if (path.endsWith("/lots/available")) return route.fulfill({ json: LOTS });
    if (post && path.endsWith("/lots/sell")) return route.fulfill({ json: ORDER });
    if (post && path.endsWith("/lots/invoice")) return route.fulfill({ json: BILL });
    return route.fulfill({ json: [] });
  });
}

async function expectNoPageOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(0);
}

/** The region scrolls its own table, takes focus from the keyboard, and moves with arrow keys. */
async function expectScrollableRegion(page: Page, region: Locator) {
  await expect(region).toBeVisible();
  await expect(region).toHaveAttribute("tabindex", "0");
  const overflow = await region.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow, "table should be wider than its region at this width").toBeGreaterThan(0);
  await region.focus();
  await expect(region).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => region.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  // The region itself stays inside the screen.
  const box = await region.boundingBox();
  const width = page.viewportSize()!.width;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width + 0.5);
}

for (const width of [360, 390]) {
  test(`customers table scrolls inside its region at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockApi(page);
    await page.goto("/sales");
    const region = page.getByRole("region", { name: "Customers" });
    await expect(region.getByText("Shri Ganesh Marble")).toBeVisible();
    await expectNoPageOverflow(page);
    await expectScrollableRegion(page, region);
    await expectNoPageOverflow(page);
  });

  test(`lot sale basket and invoice tables scroll inside their regions at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockApi(page);
    await page.goto("/lots/sell");

    await page.getByRole("combobox", { name: "Customer", exact: true }).selectOption("c1");
    await page.getByRole("combobox", { name: "Block", exact: true }).selectOption("VG-101");
    await page.getByLabel("How many slabs").fill("70");
    await page.getByLabel("Rate per sqft").fill("85");
    await page.getByRole("button", { name: "Add to sale" }).click();

    const basket = page.getByRole("region", { name: "Lots in this sale" });
    await expect(basket.getByText("VG-101")).toBeVisible();
    await expectNoPageOverflow(page);
    await expectScrollableRegion(page, basket);

    await page.getByRole("button", { name: "Confirm sale and deduct stock" }).click();
    await page.getByRole("button", { name: "Raise tax invoice" }).click();
    await expect(page.getByRole("heading", { name: "Tax invoice INV-2026-00042" })).toBeVisible();

    const lines = page.getByRole("region", { name: "Invoice lines" });
    const hsn = page.getByRole("region", { name: "HSN tax summary" });
    // Two tables, two names: a screen reader's region list can tell them apart.
    await expect(page.getByRole("region", { name: "Sale details" })).toHaveCount(0);
    await expectNoPageOverflow(page);
    await expectScrollableRegion(page, lines);
    await expectScrollableRegion(page, hsn);
    await expectNoPageOverflow(page);
  });
}
