import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const set = vi.fn();
const hdrs = vi.hoisted(() => ({ xff: "9.9.9.9" as string | undefined }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(hdrs.xff === undefined ? {} : { "x-forwarded-for": hdrs.xff }),
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

beforeEach(async () => {
  set.mockClear();
  hdrs.xff = "9.9.9.9";
  process.env.APP_PASSWORD = "correct-horse";
  (await import("@/lib/login-guard")).resetThrottle();
});
afterEach(() => {
  vi.useRealTimers();
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

describe("login: refuses the default / missing password", () => {
  it.each([undefined, "", "change-me", "CHANGE-ME", " Change-Me "])("APP_PASSWORD=%j", async (pw) => {
    if (pw === undefined) delete process.env.APP_PASSWORD;
    else process.env.APP_PASSWORD = pw;
    const { login } = await import("./actions");
    // even typing the example value itself does not get in
    for (const typed of ["change-me", "", "anything"]) {
      const res = await login(undefined, form(typed));
      expect(res.error).toBe("APP_PASSWORD is not configured — set a real password in .env");
    }
    expect(set).not.toHaveBeenCalled();
  });
});

describe("login throttle", () => {
  const wrong = async () => (await (await import("./actions")).login(undefined, form("nope"))).error;

  it("locks one client after 5 failures, with the existing messages", async () => {
    for (let i = 1; i < 5; i++) expect(await wrong()).toBe("Wrong password.");
    expect(await wrong()).toBe("Too many attempts — wait a minute.");
    const { login } = await import("./actions");
    expect((await login(undefined, form("correct-horse"))).error).toBe("Too many attempts — wait a minute."); // locked, even with the right one
  });

  it("keys on the LAST x-forwarded-for entry: a spoofed leftmost value does not reset the lock", async () => {
    for (let i = 0; i < 5; i++) {
      hdrs.xff = `10.0.0.${i}, 1.2.3.4`;
      await wrong();
    }
    hdrs.xff = "10.9.9.9, 1.2.3.4";
    expect(await wrong()).toBe("Too many attempts — wait a minute.");
  });

  it("rotating the whole header cannot brute-force; a flood only slows the owner, never locks them out", async () => {
    vi.useFakeTimers(); // setTimeout and Date
    const { login } = await import("./actions");
    const { GLOBAL_FREE_ATTEMPTS, GLOBAL_MAX_QUEUE } = await import("@/lib/login-guard");
    const tryPw = (i: number, pw = "nope") => {
      hdrs.xff = `10.0.${(i >> 8) & 255}.${i & 255}`; // a fresh "client" every time
      return login(undefined, form(pw));
    };
    for (let i = 0; i < GLOBAL_FREE_ATTEMPTS; i++) expect((await tryPw(i)).error).toBe("Wrong password."); // no delay yet

    // 200 parallel guesses from 200 "clients": only a handful are even checked, the rest are turned away unchecked
    const flood = Array.from({ length: 200 }, (_, i) => tryPw(100 + i));
    await vi.advanceTimersByTimeAsync(GLOBAL_MAX_QUEUE * 10_000);
    const errors = (await Promise.all(flood)).map((r) => r.error);
    expect(errors.filter((e) => e === "Wrong password.")).toHaveLength(GLOBAL_MAX_QUEUE);
    expect(errors.filter((e) => e === "Too many attempts — wait a few minutes.")).toHaveLength(200 - GLOBAL_MAX_QUEUE);

    // flood over: the right password gets in after at most one delay step (10 s), not locked out
    const owner = tryPw(999, "correct-horse").catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await owner).toBe("REDIRECT:/");
    expect(set).toHaveBeenCalledOnce();
  });

  it("successful logins do not eat the global budget", async () => {
    const { login } = await import("./actions");
    for (let i = 0; i < 60; i++) {
      hdrs.xff = `10.1.0.${i}`;
      await expect(login(undefined, form("correct-horse"))).rejects.toThrow("REDIRECT:/");
    }
  });
});

describe("login: ?next= open redirect", () => {
  it.each(["/.//evil.example", "/a/..//evil.example", "//evil.example", "/\\evil.example"])("%j lands on /", async (next) => {
    const { login } = await import("./actions");
    const f = form("correct-horse");
    f.set("next", next);
    await expect(login(undefined, f)).rejects.toThrow("REDIRECT:/");
  });
  it("keeps a normal path", async () => {
    const { login } = await import("./actions");
    const f = form("correct-horse");
    f.set("next", "/ideas?status=taken");
    await expect(login(undefined, f)).rejects.toThrow("REDIRECT:/ideas?status=taken");
  });
});
