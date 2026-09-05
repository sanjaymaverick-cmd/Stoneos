import { expect, test } from "@playwright/test";

test("login page has no public signup", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "StoneOS" })).toBeVisible();
  await expect(page.getByText("There is no public signup")).toBeVisible();
  await expect(page.getByRole("link", { name: /sign up/i })).toHaveCount(0);
});
