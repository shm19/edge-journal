import { authed as test, chooseOption, expect, fillPrices, newIdea, saveIdea, setDateTime, TINY_PNG } from "./helpers";

test.describe.configure({ mode: "serial" });

test("taken trade with alternative, linked mistake and screenshot", async ({ page }) => {
  await newIdea(page, "Taken", "BTC");
  await fillPrices(page, 0, { entry: "100", stop: "90", target: "130" });
  await page.getByRole("button", { name: "Stopped" }).click(); // primary: exit at the stop = -1R
  // Fixed past dates (before the ETH trade below) so ordering and "largest loss" never depend on the real clock.
  await setDateTime(page, "Opened (UTC)", "2026-10-01 09:00");
  await setDateTime(page, "Closed (UTC)", "2026-10-01 18:00");

  // Alternative "BE stop": a copy of the primary, closed at breakeven = 0R.
  await page.getByRole("button", { name: "Add BE stop" }).click();
  await expect(page.getByLabel("Alternative 1 type")).toHaveText("BE stop");
  await page.getByRole("button", { name: "Breakeven" }).nth(1).click();

  // Mistake type created inline (second "New type" on the page; the first belongs to alternatives).
  await page.getByRole("button", { name: "New type" }).last().click();
  await page.getByLabel("New type name").fill("Entered early");
  await page.getByRole("button", { name: "Create & add" }).click();
  await chooseOption(page, "Measure against alternative", "BE stop");
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

  // Typed UTC times round-trip; the calendar popover opens, picks a day and returns focus on Escape.
  await setDateTime(page, "Opened (UTC)", "2026-10-02 14:30");
  await setDateTime(page, "Closed (UTC)", "2026-10-02 23:59");
  const calendar = page.getByRole("button", { name: "Open calendar for Closed (UTC)" });
  await calendar.click();
  await page.getByRole("button", { name: "3 October 2026, Saturday" }).click(); // keeps the time
  await expect(page.getByLabel("Closed (UTC)", { exact: true })).toHaveValue("2026-10-03 23:59");
  await page.keyboard.press("Escape");
  await expect(calendar).toBeFocused();
  await page.getByLabel("Opened (UTC)", { exact: true }).fill("2026-02-30 10:00");
  await expect(page.getByText("Use YYYY-MM-DD HH:mm (24h, UTC).")).toBeVisible();
  // Invalid text must not be silently dropped: Save is refused and names the field.
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Fix the Opened date first")).toBeVisible();
  await expect(page).toHaveURL(/\/ideas\/new$/);
  await setDateTime(page, "Opened (UTC)", "2026-10-02 14:30");

  await saveIdea(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("ETH");
  await expect(page.getByText("14:30").first()).toBeVisible();
  await expect(page.getByText("23:59").first()).toBeVisible();
  await expect(page.getByText("+3.00R").first()).toBeVisible();
});
