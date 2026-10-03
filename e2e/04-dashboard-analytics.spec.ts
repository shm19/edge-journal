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

test("date-range filter: typed and preset ranges set from / to as YYYY-MM-DD", async ({ page }) => {
  await page.goto("/ideas");
  await page.getByRole("button", { name: /^Date range/ }).click();
  await page.getByLabel("From (UTC)").fill("2026-10-01");
  await page.getByLabel("To (UTC)").fill("2026-10-02");
  await expect(page).toHaveURL(/from=2026-10-01&to=2026-10-02/);
  // The list really filters: ETH was opened on 2026-10-02 (spec 02), so it is in this range and not in an earlier one.
  await expect(page.getByRole("link", { name: /ETH/ }).first()).toBeVisible();
  await page.getByLabel("From (UTC)").fill("2026-09-01");
  await page.getByLabel("To (UTC)").fill("2026-09-02");
  await expect(page).toHaveURL(/from=2026-09-01&to=2026-09-02/);
  await expect(page.getByRole("link", { name: /ETH/ })).toHaveCount(0);
  await page.getByLabel("From (UTC)").fill("2026-10-01");
  await page.getByLabel("To (UTC)").fill("2026-10-02");
  await expect(page.getByRole("link", { name: /ETH/ }).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Date range, 2026-10-01 → 2026-10-02" })).toBeFocused();
  await page.getByRole("button", { name: /^Date range/ }).click();
  await page.getByRole("button", { name: "Yesterday" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0); // a preset closes the popover
  await expect(page).toHaveURL(/from=(\d{4}-\d{2}-\d{2})&to=\1/);
  await page.getByRole("button", { name: /^Date range/ }).click();
  await page.getByRole("button", { name: "Last 7 days" }).click();
  await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/);
  await page.getByRole("button", { name: /^Date range/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Clear" }).click();
  await expect(page).not.toHaveURL(/from=/);
});
