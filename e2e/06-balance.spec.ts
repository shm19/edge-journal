import { authed as test, expect, kpi } from "./helpers";

// Data from 02: taken BTC -1R and ETH +3R at the default 1% risk (the order does not change the compounding result).
// Compounding on $1,000: 990 -> 1,019.70 (or 1,030 -> 1,019.70). Fixed: 990 -> 1,020.
test("balance simulator: dashboard card, Balance tab, mode change, validation, remembered inputs", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("$1,000.00 → $1,019.70")).toBeVisible();
  await expect(page.getByText(/Hypothetical, not your account · all time, taken trades/)).toBeVisible();
  await expect(page.getByText(/too few to trust/).first()).toBeVisible();

  await page.getByRole("link", { name: /Simulate/ }).click();
  await expect(page).toHaveURL(/tab=balance&start=1000&risk=1&mode=compounding/);
  await expect(page.getByText(/Hypothetical: assumes the stated risk on every trade/)).toBeVisible();
  await expect(kpi(page, "Ending balance \\(simulated\\)")).toContainText("$1,019.70");
  await expect(kpi(page, "P/L")).toContainText("+$19.70");
  await expect(kpi(page, "P/L")).toContainText("+2.00R total · 1% risk per trade");
  await expect(page.getByText("Hypothetical balance in $, simulated from your R results.")).toBeVisible();
  await expect(kpi(page, "Largest loss")).toContainText("-$10.00");
  await expect(page.getByRole("row", { name: /\+3\.00R/ })).toContainText("$1,019.70");

  await page.getByRole("radio", { name: "Fixed" }).click(); // applies at once, no Run
  await expect(page).toHaveURL(/mode=fixed/);
  await expect(kpi(page, "Ending balance \\(simulated\\)")).toContainText("$1,020.00");

  // Invalid input: inline error, no results, nothing silently replaced.
  await page.getByLabel("Starting balance ($)").fill("0");
  await page.getByRole("button", { name: "Run" }).click();
  await expect(page.getByText("Starting balance must be more than 0")).toBeVisible();
  await expect(page.getByText("Ending balance (simulated)")).toHaveCount(0);

  // Filters apply: no backtest trades exist, so the empty state shows, not zeros.
  await page.goto("/analytics?tab=balance&status=backtest");
  await expect(page.getByText("No closed trades match these filters.")).toBeVisible();

  // Reset goes back to the defaults and forgets the stored run.
  await page.goto("/analytics?tab=balance");
  await expect(page).toHaveURL(/start=/); // the stored (fixed) run is restored first
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(page).not.toHaveURL(/start=/);
  await expect(page.getByLabel("Starting balance ($)")).toHaveValue("1000");
  await page.goto("/");
  await expect(page.getByText("$1,000.00 → $1,019.70")).toBeVisible();
  await page.goto("/analytics?tab=balance");
  await page.getByRole("radio", { name: "Fixed" }).click();
  await expect(page).toHaveURL(/mode=fixed/);

  // The last valid run is remembered: the dashboard card now uses fixed mode.
  await page.goto("/");
  await expect(page.getByText("$1,000.00 → $1,020.00")).toBeVisible();
});
