import { authed as test, expect, fillPrices, newIdea, saveIdea, TINY_PNG } from "./helpers";

test.describe.configure({ mode: "serial" });

test("taken trade with alternative, linked mistake and screenshot", async ({ page }) => {
  await newIdea(page, "Taken", "BTC");
  await fillPrices(page, 0, { entry: "100", stop: "90", target: "130" });
  await page.getByRole("button", { name: "Stopped" }).click(); // primary: exit at the stop = -1R

  // Alternative "BE stop": a copy of the primary, closed at breakeven = 0R.
  await page.getByRole("button", { name: "Add BE stop" }).click();
  await expect(page.getByLabel("Alternative 1 type")).toHaveValue(/\d+/);
  await page.getByRole("button", { name: "Breakeven" }).nth(1).click();

  // Mistake type created inline (second "New type" on the page; the first belongs to alternatives).
  await page.getByRole("button", { name: "New type" }).last().click();
  await page.getByLabel("New type name").fill("Entered early");
  await page.getByRole("button", { name: "Create & add" }).click();
  await page.getByLabel("Measure against alternative").selectOption({ label: "BE stop" });
  await expect(page.getByTitle("R lost because of this mistake")).toContainText("-1.00R lost");
  await page.getByLabel("Mistake note").fill("Entered before the candle closed");

  // Screenshot through the hidden file input (same path as the "Add" button).
  await page.getByLabel("Add screenshots").setInputFiles({ name: "chart.png", mimeType: "image/png", buffer: TINY_PNG });
  await expect(page.getByRole("img", { name: "Screenshot" })).toBeVisible();

  await saveIdea(page);

  await expect(page.getByRole("heading", { name: "BTC" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("BTC");
  await expect(page.getByText("-1.00R").first()).toBeVisible(); // the trade's R
  const mistakes = page.locator("li", { hasText: "Entered early" });
  await expect(mistakes).toContainText("measured against “BE stop”");
  await expect(mistakes).toContainText("-1.00R"); // signed cost: R lost is negative
  await expect(page.getByRole("img", { name: "Screenshot" }).first()).toHaveAttribute("src", /\/api\/uploads\//);
});

test("second taken trade, a winner", async ({ page }) => {
  await newIdea(page, "Taken", "ETH");
  await fillPrices(page, 0, { entry: "200", stop: "190", target: "230" });
  await page.getByRole("button", { name: "Hit target" }).first().click(); // +3R
  await saveIdea(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("ETH");
  await expect(page.getByText("+3.00R").first()).toBeVisible();
});
