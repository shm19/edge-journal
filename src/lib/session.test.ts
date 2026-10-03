import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cookieSecure, createSessionToken, passwordConfigured, SESSION_MAX_AGE, verifySessionToken } from "./session";

const env = process.env as Record<string, string | undefined>;
const SECRET = "test-secret-test-secret-test-secret-0123";
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = { APP_PASSWORD: env.APP_PASSWORD, SESSION_SECRET: env.SESSION_SECRET, NODE_ENV: env.NODE_ENV, COOKIE_SECURE: env.COOKIE_SECURE };
  env.SESSION_SECRET = SECRET;
  env.APP_PASSWORD = "a-real-password";
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

describe("revocation and claim checks", () => {
  /** Mint a token the way createSessionToken does, but with an arbitrary key/alg/claims. */
  async function mint(opts: { secret?: string; password?: string; alg?: string; exp?: boolean }) {
    const bytes = new TextEncoder().encode(`${opts.secret ?? SECRET}:${opts.password ?? "a-real-password"}`);
    const key = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const jwt = new SignJWT({ sub: "owner" }).setProtectedHeader({ alg: opts.alg ?? "HS256" }).setIssuedAt();
    if (opts.exp !== false) jwt.setExpirationTime("1h");
    return jwt.sign(key);
  }

  it("the key is SHA-256(secret:password): an independently minted token verifies", async () => {
    expect(await verifySessionToken(await mint({}))).toBe(true);
  });

  it("changing APP_PASSWORD invalidates every existing session", async () => {
    const t = await createSessionToken();
    env.APP_PASSWORD = "a-different-password";
    expect(await verifySessionToken(t)).toBe(false);
    env.APP_PASSWORD = "a-real-password";
    expect(await verifySessionToken(t)).toBe(true);
  });

  it("the secret and password are not interchangeable in the key", async () => {
    expect(await verifySessionToken(await mint({ password: "other" }))).toBe(false);
    expect(await verifySessionToken(await mint({ secret: "x".repeat(40) }))).toBe(false);
  });

  it("rejects a token without exp", async () => {
    expect(await verifySessionToken(await mint({ exp: false }))).toBe(false);
  });

  it("pins HS256", async () => {
    expect(await verifySessionToken(await mint({ alg: "HS512" }))).toBe(false);
  });

  it("refuses sessions while APP_PASSWORD is unset, blank or the example value", async () => {
    const t = await createSessionToken();
    for (const pw of [undefined, "", "  ", "change-me", "Change-Me", " CHANGE-ME "]) {
      if (pw === undefined) delete env.APP_PASSWORD;
      else env.APP_PASSWORD = pw;
      expect(await verifySessionToken(t)).toBe(false);
      await expect(createSessionToken()).rejects.toThrow(/APP_PASSWORD/);
    }
  });
});

describe("passwordConfigured", () => {
  it.each([
    [undefined, false],
    ["", false],
    ["   ", false],
    ["change-me", false],
    ["CHANGE-ME", false],
    [" Change-Me ", false],
    ["change-me-please", true],
    ["a-real-password", true],
  ])("%j -> %s", (pw, expected) => {
    if (pw === undefined) delete env.APP_PASSWORD;
    else env.APP_PASSWORD = pw;
    expect(passwordConfigured()).toBe(expected);
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
