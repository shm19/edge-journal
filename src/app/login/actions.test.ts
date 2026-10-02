import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const set = vi.fn();
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "9.9.9.9" }),
  cookies: async () => ({ set, delete: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

const form = (pw: string) => {
  const f = new FormData();
  f.set("password", pw);
  return f;
};
const SECRET = process.env.SESSION_SECRET;

beforeEach(() => {
  set.mockClear();
  process.env.APP_PASSWORD = "correct-horse";
});
afterEach(() => {
  process.env.SESSION_SECRET = SECRET;
});

describe("login", () => {
  it("sets the cookie and redirects on the right password", async () => {
    const { login } = await import("./actions");
    await expect(login(undefined, form("correct-horse"))).rejects.toThrow("REDIRECT:/");
    expect(set).toHaveBeenCalledOnce();
  });

  it("returns an error (no cookie) when SESSION_SECRET is missing or short", async () => {
    const { login } = await import("./actions");
    for (const secret of [undefined, "short"]) {
      if (secret === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = secret;
      const res = await login(undefined, form("correct-horse"));
      expect(res.error).toMatch(/SESSION_SECRET is not configured/);
    }
    expect(set).not.toHaveBeenCalled();
  });
});
