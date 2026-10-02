import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cookieSecure, createSessionToken, SESSION_MAX_AGE, verifySessionToken } from "./session";

const env = process.env as Record<string, string | undefined>;
const SECRET = "test-secret-test-secret-test-secret-0123";
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = { SESSION_SECRET: env.SESSION_SECRET, NODE_ENV: env.NODE_ENV, COOKIE_SECURE: env.COOKIE_SECURE };
  env.SESSION_SECRET = SECRET;
});
afterEach(() => {
  vi.useRealTimers();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
});

describe("session token", () => {
  it("signs and verifies", async () => {
    expect(await verifySessionToken(await createSessionToken())).toBe(true);
  });

  it("rejects missing, garbage and tampered tokens", async () => {
    expect(await verifySessionToken(undefined)).toBe(false);
    expect(await verifySessionToken("not.a.jwt")).toBe(false);
    const t = await createSessionToken();
    expect(await verifySessionToken(t.slice(0, -2) + (t.endsWith("AA") ? "BB" : "AA"))).toBe(false);
  });

  it("rejects a token signed with another secret", async () => {
    const t = await createSessionToken();
    env.SESSION_SECRET = "another-secret-another-secret-another-0123";
    expect(await verifySessionToken(t)).toBe(false);
  });

  it("expires after the max age", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const t = await createSessionToken();
    vi.setSystemTime(Date.now() + (SESSION_MAX_AGE - 60) * 1000);
    expect(await verifySessionToken(t)).toBe(true);
    vi.setSystemTime(Date.now() + 120 * 1000);
    expect(await verifySessionToken(t)).toBe(false);
  });
});

describe("secret handling fails closed", () => {
  it.each(["production", "test", undefined])("throws without a usable secret when NODE_ENV=%s", async (nodeEnv) => {
    if (nodeEnv === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = nodeEnv;
    delete env.SESSION_SECRET;
    await expect(createSessionToken()).rejects.toThrow(/SESSION_SECRET/);
    env.SESSION_SECRET = "too-short";
    await expect(createSessionToken()).rejects.toThrow(/SESSION_SECRET/);
    // verify never lets an unconfigured server accept anything
    expect(await verifySessionToken("a.b.c")).toBe(false);
  });

  it("uses the public fallback only in development", async () => {
    env.NODE_ENV = "development";
    delete env.SESSION_SECRET;
    expect(await verifySessionToken(await createSessionToken())).toBe(true);
  });
});

describe("cookieSecure", () => {
  it.each([
    ["production", undefined, true],
    ["production", "", true],
    ["production", "false", false],
    ["production", " FALSE ", false],
    ["production", "0", true],
    ["production", "no", true],
    ["production", "True", true],
    ["development", undefined, false],
    ["development", "true", true],
    ["development", "false", false],
  ])("NODE_ENV=%s COOKIE_SECURE=%j -> %s", (nodeEnv, flag, expected) => {
    env.NODE_ENV = nodeEnv;
    if (flag === undefined) delete env.COOKIE_SECURE;
    else env.COOKIE_SECURE = flag;
    expect(cookieSecure()).toBe(expected);
  });
});
