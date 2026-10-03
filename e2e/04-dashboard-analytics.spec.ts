import { authed as test, chooseOption, expect, kpi } from "./helpers";

// Data from 02/03: taken BTC -1R and ETH +3R; a skipped (+1.5R), a forward-test Hit and a Miss that must NOT count.
test("dashboard KPIs match the hand-calculated numbers (taken only)", async ({ page }) => {
  await page.goto("/");
  await expect(kpi(page, "Closed trades")).toContainText("2");
  await expect(kpi(page, "Win rate")).toContainText("50%");
  await expect(kpi(page, "Win rate")).toContainText("1W · 1L · 0BE");
  await expect(kpi(page, "Expectancy")).toContainText("+1.00R");
  await expect(kpi(page, "Total")).toContainText("+2.00R");
  await expect(kpi(page, "Total")).toContainText("best +3.00R · worst -1.00R");
  await expect(kpi(page, "Profit factor")).toContainText("3.00");
});

test("analytics: group-by changes the table", async ({ page }) => {
  await page.goto("/analytics");
  const table = page.getByRole("table");
  await expect(table.getByRole("columnheader", { name: "Setup" })).toBeVisible();

  await chooseOption(page, "Group by", "Coin");
  await expect(page).toHaveURL(/group=symbol/);
  await expect(table.getByRole("columnheader", { name: "Coin" })).toBeVisible();
  await expect(table.getByRole("row", { name: /^BTC/ })).toContainText("-1.00R");
  await expect(table.getByRole("row", { name: /^ETH/ })).toContainText("+3.00R");

  await chooseOption(page, "Group by", "Mistake");
  await expect(table.getByRole("row", { name: /Entered early/ })).toBeVisible();
});

test("analytics: alternatives tab", async ({ page }) => {
  await page.goto("/analytics");
  await page.getByRole("button", { name: "Alternatives" }).click();
  await expect(page.getByText("Actual vs alternatives")).toBeVisible();
  // BE stop: actual -1R, alternative 0R -> +1.00R better.
  await expect(page.getByRole("row", { name: /BE stop/ })).toContainText("+1.00R");
});

test("analytics: skipped & missed tab", async ({ page }) => {
  await page.goto("/analytics");
  await page.getByRole("button", { name: "Skipped & missed" }).click();
  await expect(page.getByText("Skipped — by reason")).toBeVisible();
  await expect(page.getByText("R:R too small").locator("visible=true").first()).toBeVisible();
  await expect(page.getByText("R to the FTA was too small")).toBeVisible(); // skip log
});
