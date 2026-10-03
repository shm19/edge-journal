import { authed as test, expect, fillPrices, newIdea, saveIdea } from "./helpers";

test.describe.configure({ mode: "serial" });

test("skipped idea with a skip reason tag", async ({ page }) => {
  await newIdea(page, "Skipped", "BTC");
  await fillPrices(page, 0, { entry: "100", stop: "90", target: "115" });
  await page.getByRole("button", { name: "Hit target" }).first().click(); // what would have happened: +1.5R
  await page.getByLabel("Why did you skip it?").fill("R to the FTA was too small");
  const tag = page.getByRole("button", { name: "R:R too small", exact: true });
  await tag.click();
  await expect(tag).toHaveAttribute("aria-pressed", "true");
  await saveIdea(page);

  await expect(page.getByText("Skipped").first()).toBeVisible();
  await expect(page.getByText("R to the FTA was too small")).toBeVisible();
  await expect(page.getByText("R:R too small").first()).toBeVisible();
});

test("forward test marked Hit with no prices", async ({ page }) => {
  await newIdea(page, "Forward test", "ETH");
  await page.getByRole("radio", { name: "Hit / Miss" }).click();
  await page.getByRole("radio", { name: "Hit", exact: true }).click();
  await saveIdea(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("ETH");
  await expect(page.getByText("Hit", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Forward test").first()).toBeVisible();
});

test("forward test marked Miss shows in the journal", async ({ page }) => {
  await newIdea(page, "Forward test", "SOL");
  await page.getByRole("radio", { name: "Hit / Miss" }).click();
  await page.getByRole("radio", { name: "Miss", exact: true }).click();
  await saveIdea(page);
  await expect(page.getByText("Miss", { exact: true }).first()).toBeVisible();
  await page.goto("/ideas");
  await expect(page.getByRole("link", { name: /SOL/ })).toBeVisible();
});
