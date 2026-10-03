import { acceptNextDialog, authed as test, expect } from "./helpers";

test.describe.configure({ mode: "serial" });

test("settings: add, rename and delete a tag", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Tag", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("E2E tag");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const tag = page.getByRole("button", { name: "Edit tag E2E tag", exact: true });
  await expect(tag).toBeVisible();

  await tag.click();
  await page.getByLabel("Name", { exact: true }).fill("E2E tag renamed");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit tag E2E tag renamed" })).toBeVisible();
  await expect(tag).toHaveCount(0);

  await page.getByRole("button", { name: "Edit tag E2E tag renamed" }).click();
  acceptNextDialog(page);
  await page.getByRole("button", { name: "Delete tag" }).click();
  await expect(page.getByRole("button", { name: /Edit tag E2E tag/ })).toHaveCount(0);
});

test("settings: add, rename and delete a mistake type", async ({ page }) => {
  await page.goto("/settings");
  const nameInput = () => page.getByLabel("Name", { exact: true });
  const saveIcon = () => page.getByRole("button", { name: "Save type" });

  await page.getByRole("button", { name: "Type" }).last().click(); // second "+ Type": mistake types
  await nameInput().fill("E2E mistake");
  await saveIcon().click();
  const row = page.locator("li", { hasText: "E2E mistake" });
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "Edit" }).click();
  await nameInput().fill("E2E mistake renamed");
  await saveIcon().click();
  await expect(page.locator("li", { hasText: "E2E mistake renamed" })).toBeVisible();

  acceptNextDialog(page);
  await page.locator("li", { hasText: "E2E mistake renamed" }).getByRole("button", { name: "Delete" }).click();
  await expect(page.locator("li", { hasText: "E2E mistake" })).toHaveCount(0);
});

test("CSV export has the header and the trade row", async ({ page }) => {
  const res = await page.request.get("/api/export?format=csv");
  expect(res.ok()).toBe(true);
  expect(res.headers()["content-type"]).toContain("text/csv");
  const [header, ...rows] = (await res.text()).split("\n");
  expect(header).toMatch(/^id,status,opened_at,closed_at,symbol,direction,/);
  const btc = rows.find((r) => r.includes(",taken,") && r.includes(",BTC,"));
  expect(btc, "BTC taken row").toBeTruthy();
  expect(btc).toContain("-1.000"); // r
  expect(btc).toContain("Entered early (1.00R)");
  expect(btc).toContain("BE stop: 100/90/130");
  expect(rows.some((r) => r.includes(",skipped,"))).toBe(true);
  expect(rows.some((r) => r.includes(",forward_test,"))).toBe(true);
});

test("sign out returns to /login and protected pages redirect", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/ideas");
  await expect(page).toHaveURL(/\/login\?next=%2Fideas/);
  expect((await page.request.get("/api/export?format=csv")).status()).toBe(401);
});
