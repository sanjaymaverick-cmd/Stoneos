import { expect, test } from "@playwright/test";

test("login page has no public signup", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "StoneOS" })).toBeVisible();
  await expect(page.getByText("There is no public signup")).toBeVisible();
  await expect(page.getByRole("link", { name: /sign up/i })).toHaveCount(0);
});

test("owner signs in and is forced to change the bootstrap password", async ({ page }) => {
  const username = process.env.E2E_USERNAME ?? "owner";
  const password = process.env.E2E_PASSWORD ?? "ChangeMeNow!12";
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Username" }).fill(username);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/account\/password/);
  await expect(page.getByRole("heading", { name: "Change password" })).toBeVisible();
});
