import { expect, test as base, type Page } from "@playwright/test";
import { PASSWORD } from "./env";

/** 1x1 PNG, enough for the upload route's magic-byte check. */
export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** Every test fails on browser console errors or uncaught page errors. */
export const test = base.extend<{ errors: string[] }>({
  errors: [
    async ({ page }, run) => {
      const errors: string[] = [];
      page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
      page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
      await run(errors);
      expect(errors, "console / page errors").toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

export async function login(page: Page, password: string = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** A logged-in page: the common starting point of every spec after 01-login. */
export const authed = test.extend({
  page: async ({ page }, run) => {
    await login(page);
    await run(page);
  },
});

export async function newIdea(page: Page, status: "Taken" | "Skipped" | "Forward test", symbol: string) {
  await page.goto("/ideas/new");
  await page.getByRole("radio", { name: status, exact: true }).click();
  await page.getByLabel("Coin", { exact: true }).fill(symbol);
}

/** Fill the n-th scenario card (0 = primary). */
export async function fillPrices(page: Page, n: number, p: { entry: string; stop: string; target?: string }) {
  await page.getByLabel("Entry", { exact: true }).nth(n).fill(p.entry);
  await page.getByLabel("Stop", { exact: true }).nth(n).fill(p.stop);
  if (p.target) await page.getByLabel("Target (FTA)").nth(n).fill(p.target);
}

export async function saveIdea(page: Page) {
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/\/ideas\/\d+$/);
}

/** The KPI tile with this label, on the dashboard. */
export const kpi = (page: Page, label: string) => page.locator("p", { hasText: new RegExp(`^${label}$`) }).locator("..");

export const acceptNextDialog = (page: Page) => page.once("dialog", (d) => void d.accept());
