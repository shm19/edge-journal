import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionToken, SESSION_COOKIE } from "./session";

const jar = vi.hoisted(() => ({ value: undefined as string | undefined }));
const redirect = vi.hoisted(() =>
  vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
);
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "ej_session" && jar.value ? { name, value: jar.value } : undefined) }),
}));
vi.mock("next/navigation", () => ({ redirect }));

import { isAuthenticated, passwordMatches, requireAuth } from "./auth";

beforeEach(() => {
  jar.value = undefined;
  redirect.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("passwordMatches", () => {
  it("accepts only the exact APP_PASSWORD", () => {
    vi.stubEnv("APP_PASSWORD", "correct horse");
    expect(passwordMatches("correct horse")).toBe(true);
    expect(passwordMatches("correct horse ")).toBe(false);
    expect(passwordMatches("")).toBe(false);
  });
  it("rejects everything when APP_PASSWORD is unset", () => {
    vi.stubEnv("APP_PASSWORD", "");
    expect(passwordMatches("")).toBe(false);
    expect(passwordMatches("anything")).toBe(false);
  });
});

describe("isAuthenticated / requireAuth", () => {
  it("is false without a cookie or with a garbage one, and redirects to /login", async () => {
    expect(await isAuthenticated()).toBe(false);
    jar.value = "not-a-jwt";
    expect(await isAuthenticated()).toBe(false);
    await expect(requireAuth()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(redirect).toHaveBeenCalledWith("/login");
  });
  it("is true with a valid session cookie and does not redirect", async () => {
    jar.value = await createSessionToken();
    expect(SESSION_COOKIE).toBe("ej_session");
    expect(await isAuthenticated()).toBe(true);
    await requireAuth();
    expect(redirect).not.toHaveBeenCalled();
  });
});
