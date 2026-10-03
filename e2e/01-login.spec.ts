import { PASSWORD } from "./env";
import { expect, login, test } from "./helpers";

// The login throttle is keyed on x-forwarded-for; each test uses its own fake client so a lockout can't leak.
const as = (ip: string) => ({ extraHTTPHeaders: { "x-forwarded-for": ip } });

test.describe("wrong password and throttle", () => {
  test.use(as("10.9.0.1"));

  test("wrong password is rejected, repeated failures lock the client", async ({ page }) => {
    await page.goto("/login");
    const attempt = async (pw: string) => {
      await page.getByLabel("Password").fill(pw);
      const posted = page.waitForResponse((r) => r.request().method() === "POST");
      await page.getByRole("button", { name: "Sign in" }).click();
      await posted;
    };

    await attempt("definitely-wrong");
    await expect(page.getByText("Wrong password.")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);

    for (let i = 0; i < 3; i++) await attempt("definitely-wrong"); // failures 2..4
    await attempt("definitely-wrong"); // the 5th locks
    await expect(page.getByText(/Too many attempts/)).toBeVisible();

    await attempt(PASSWORD); // even the right password is refused while locked
    await expect(page.getByText(/Too many attempts/)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("right password", () => {
  test.use(as("10.9.0.2"));

  test("signs in and lands on the dashboard", async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("keeps ?next= through the login redirect", async ({ page }) => {
    await page.goto("/ideas?x=1");
    await expect(page).toHaveURL(/\/login\?next=%2Fideas%3Fx%3D1/);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/ideas?x=1");
  });

  test("ignores an off-site ?next=", async ({ page }) => {
    await page.goto("/login?next=//evil.example");
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/");
  });
});
