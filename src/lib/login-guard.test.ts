import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearFailures,
  gatedCheck,
  clientKey,
  FAIL_WINDOW_MS,
  GLOBAL_FREE_ATTEMPTS,
  GLOBAL_MAX_DELAY_MS,
  GLOBAL_MAX_QUEUE,
  GLOBAL_STEP_MS,
  GLOBAL_WINDOW_MS,
  isLocked,
  LOCK_MS,
  MAX_FAILS,
  MAX_KEY_LEN,
  MAX_KEYS,
  recordFailure,
  resetThrottle,
  safeNext,
  trackedKeys,
} from "./login-guard";

describe("safeNext", () => {
  it.each([
    ["/", "/"],
    ["/ideas", "/ideas"],
    ["/ideas?status=taken&x=1", "/ideas?status=taken&x=1"],
    ["//evil.com", "/"],
    ["//evil.com/path", "/"],
    ["/\\evil.com", "/"],
    ["/\\\\evil.com", "/"],
    ["/ok\\path", "/"],
    ["https://evil.com", "/"],
    ["http://evil.com/x", "/"],
    ["javascript:alert(1)", "/"],
    ["evil.com", "/"],
    ["", "/"],
    // dot segments collapse into a protocol-relative URL
    ["/.//evil.example", "/"],
    ["/a/..//evil.example", "/"],
    ["/a/../..//evil.example/x?y=1", "/"],
    ["/..//evil.example", "/"],
    ["/././/evil.example", "/"],
    ["/%2e//evil.example", "/"],
    ["/%2E/%2e//evil.example", "/"],
    ["/%5cevil.example", "/%5cevil.example"], // stays a literal path segment: same-origin
    ["/\t/evil.com", "/"],
    ["/.\n/evil.com", "/evil.com"], // newline stripped by the parser -> a same-origin path, harmless
    // legitimate dot segments still work
    ["/a/../ideas?x=1", "/ideas?x=1"],
    ["/./ideas", "/ideas"],
  ])("%j -> %j", (raw, expected) => {
    expect(safeNext(raw)).toBe(expected);
  });
});

describe("login throttle", () => {
  beforeEach(resetThrottle);

  it("locks after MAX_FAILS failures and unlocks after LOCK_MS", () => {
    const t0 = 1_000_000;
    for (let i = 1; i < MAX_FAILS; i++) {
      expect(recordFailure("a", t0)).toBe(false);
      expect(isLocked("a", t0)).toBe(false);
    }
    expect(recordFailure("a", t0)).toBe(true);
    expect(isLocked("a", t0 + 1)).toBe(true);
    expect(isLocked("a", t0 + LOCK_MS - 1)).toBe(true);
    expect(isLocked("a", t0 + LOCK_MS)).toBe(false);
    // the counter restarted: one failure doesn't lock again
    expect(recordFailure("a", t0 + LOCK_MS)).toBe(false);
  });

  it("is per client and a success clears the counter", () => {
    for (let i = 0; i < MAX_FAILS - 1; i++) recordFailure("a", 0);
    clearFailures("a");
    expect(recordFailure("a", 0)).toBe(false);
    for (let i = 0; i < MAX_FAILS; i++) recordFailure("b", 0);
    expect(isLocked("b", 1)).toBe(true);
    expect(isLocked("c", 1)).toBe(false);
  });

  it("prunes expired locks of other clients", () => {
    for (let i = 0; i < MAX_FAILS; i++) recordFailure("old", 0);
    recordFailure("new", LOCK_MS + 1);
    expect(isLocked("old", 1)).toBe(false); // pruned, not merely expired
  });
});

describe("safeNext: tab/newline smuggling", () => {
  it("rejects a path that the URL parser would turn into another origin", () => {
    expect(safeNext("/\t/evil.com")).toBe("/");
    expect(safeNext("/\n/evil.com")).toBe("/");
  });
});

describe("safeNext: encoded / whitespace variants never produce a leading //", () => {
  it.each(["/.//x", "/a/..//x", "/\t/x", "/\n/x", "/\r/x", "/\t.//x", "/.\t/\t/x", "/%09/x", "/%2e%2e//x", "/%2e//x", "/./%2f/x", "/.%2f/x", "/%2f/x"])("%j", (raw) => {
    expect(safeNext(raw).startsWith("//")).toBe(false);
  });
});

describe("clientKey", () => {
  const h = (o: Record<string, string>) => new Headers(o);
  it("uses the LAST x-forwarded-for entry (the one your proxy appended)", () => {
    expect(clientKey(h({ "x-forwarded-for": "6.6.6.6, 7.7.7.7, 1.2.3.4" }))).toBe("1.2.3.4");
    expect(clientKey(h({ "x-forwarded-for": "1.2.3.4" }))).toBe("1.2.3.4");
  });
  it("trims and ignores empty entries", () => {
    expect(clientKey(h({ "x-forwarded-for": "6.6.6.6, 1.2.3.4 , , " }))).toBe("1.2.3.4");
    expect(clientKey(h({ "x-forwarded-for": " , " }))).toBe("local");
  });
  it("a spoofed leftmost value does not change the key", () => {
    const a = clientKey(h({ "x-forwarded-for": "10.0.0.1, 1.2.3.4" }));
    const b = clientKey(h({ "x-forwarded-for": "10.0.0.2, 1.2.3.4" }));
    expect(a).toBe(b);
  });
  it("falls back to x-real-ip, then 'local'", () => {
    expect(clientKey(h({ "x-real-ip": " 8.8.8.8 " }))).toBe("8.8.8.8");
    expect(clientKey(h({ "x-real-ip": " " }))).toBe("local");
    expect(clientKey(h({}))).toBe("local");
  });
  it("caps the key at 64 chars even for a 12 KB header", () => {
    const k = clientKey(h({ "x-forwarded-for": "a".repeat(12 * 1024) }));
    expect(k).toHaveLength(MAX_KEY_LEN);
    expect(clientKey(h({ "x-real-ip": "b".repeat(12 * 1024) }))).toHaveLength(MAX_KEY_LEN);
  });
});

describe("per-client map stays bounded", () => {
  beforeEach(resetThrottle);

  it("forgets a stale counter after FAIL_WINDOW_MS (never locked, so only the window prunes it)", () => {
    recordFailure("slow", 0);
    expect(trackedKeys()).toBe(1);
    recordFailure("other", FAIL_WINDOW_MS + 1);
    expect(trackedKeys()).toBe(1); // "slow" pruned
    // and its count restarted rather than carrying over
    for (let i = 1; i < MAX_FAILS; i++) recordFailure("slow", FAIL_WINDOW_MS + 2);
    expect(isLocked("slow", FAIL_WINDOW_MS + 3)).toBe(false);
  });

  it("caps the map at MAX_KEYS and evicts the oldest first", () => {
    for (let i = 0; i < MAX_KEYS + 50; i++) recordFailure(`k${i}`, 0);
    expect(trackedKeys()).toBe(MAX_KEYS);
    // the oldest were evicted: k0 starts from zero again, so MAX_FAILS-1 more failures don't lock it
    for (let i = 1; i < MAX_FAILS; i++) expect(recordFailure("k0", 0)).toBe(false);
  });

  it("a recently failing client is not the one evicted", () => {
    for (let i = 0; i < MAX_FAILS - 1; i++) recordFailure("hot", 0);
    for (let i = 0; i < MAX_KEYS; i++) recordFailure(`k${i}`, 0);
    expect(recordFailure("hot", 0)).toBe(false); // evicted (it was oldest): counter restarted
    // but touching a key moves it to the back
    resetThrottle();
    recordFailure("hot", 0);
    for (let i = 0; i < MAX_KEYS - 1; i++) recordFailure(`k${i}`, 0);
    recordFailure("hot", 0); // refresh
    recordFailure("extra", 0); // evicts k0, not hot
    for (let i = 0; i < MAX_FAILS - 2; i++) recordFailure("hot", 0);
    expect(isLocked("hot", 1)).toBe(true);
  });

  it("a lock always expires: the owner is never permanently locked out", () => {
    for (let i = 0; i < MAX_FAILS; i++) recordFailure("owner", 0);
    expect(isLocked("owner", LOCK_MS - 1)).toBe(true);
    expect(isLocked("owner", LOCK_MS)).toBe(false);
  });
});

describe("global limiter (serialised, header-independent)", () => {
  beforeEach(() => {
    resetThrottle();
    vi.useFakeTimers(); // fakes setTimeout AND Date
  });
  afterEach(() => vi.useRealTimers());

  /** One wrong-password check; resolves with the simulated time it ran at, or "refused". */
  const wrong = (log?: number[]) =>
    gatedCheck(() => {
      log?.push(Date.now());
      return false;
    });

  it("is immediate for the first GLOBAL_FREE_ATTEMPTS, then waits 1 s more each time (capped)", async () => {
    for (let i = 0; i < GLOBAL_FREE_ATTEMPTS; i++) expect(await wrong()).toEqual({ refused: false, success: false });
    for (const seconds of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10]) {
      const before = Date.now();
      let done = false;
      const p = wrong().then(() => (done = true));
      await vi.advanceTimersByTimeAsync(seconds * 1000 - 1);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await p;
      expect(Date.now() - before).toBe(seconds * 1000);
    }
  });

  it("runs checks one at a time, whatever the parallelism", async () => {
    for (let i = 0; i < GLOBAL_FREE_ATTEMPTS; i++) await wrong();
    const log: number[] = [];
    const ps = Array.from({ length: GLOBAL_MAX_QUEUE }, () => wrong(log));
    await vi.advanceTimersByTimeAsync(GLOBAL_MAX_QUEUE * GLOBAL_MAX_DELAY_MS);
    await Promise.all(ps);
    expect(log).toHaveLength(GLOBAL_MAX_QUEUE);
    for (let i = 1; i < log.length; i++) expect(log[i] - log[i - 1]).toBeGreaterThanOrEqual(GLOBAL_STEP_MS);
  });

  it("turns away callers beyond GLOBAL_MAX_QUEUE without counting them or running their check", async () => {
    for (let i = 0; i < GLOBAL_FREE_ATTEMPTS; i++) await wrong();
    const log: number[] = [];
    const ps = Array.from({ length: 200 }, () => wrong(log));
    const res = await Promise.all(ps.slice(GLOBAL_MAX_QUEUE)); // the refused ones settle at once, no timers needed
    expect(res.every((r) => r.refused)).toBe(true);
    await vi.advanceTimersByTimeAsync(GLOBAL_MAX_QUEUE * GLOBAL_MAX_DELAY_MS);
    await Promise.all(ps);
    expect(log).toHaveLength(GLOBAL_MAX_QUEUE);
  });

  it("forgets attempts once the window has slid past them", async () => {
    for (let i = 0; i < GLOBAL_FREE_ATTEMPTS; i++) await wrong();
    await vi.advanceTimersByTimeAsync(GLOBAL_WINDOW_MS + 1);
    const before = Date.now();
    await wrong(); // immediate again
    expect(Date.now()).toBe(before);
  });

  it("a successful login gives its slot back", async () => {
    for (let i = 0; i < GLOBAL_FREE_ATTEMPTS - 1; i++) await wrong();
    expect(await gatedCheck(() => true)).toEqual({ refused: false, success: true });
    // the 20th slot is free again: still no delay
    const before = Date.now();
    await wrong();
    expect(Date.now()).toBe(before);
  });

  it("a thrown check still frees its queue slot", async () => {
    await expect(gatedCheck(() => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await wrong()).toEqual({ refused: false, success: false });
  });

  it("bounds the guess rate over a simulated hour of continuous flooding (<= 400, ~360 steady state)", async () => {
    let checks = 0;
    const flood = () => {
      void gatedCheck(() => {
        checks++;
        return false;
      });
    };
    for (let s = 0; s < 3600; s++) {
      for (let i = 0; i < 20; i++) flood(); // 20 parallel requests every second, any headers
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(checks).toBeLessThanOrEqual(400);
    expect(checks).toBeGreaterThan(300); // and the limiter is not just refusing everything
  });

  it("never locks the owner out: after a flood stops, a correct password gets through within about a minute", async () => {
    for (let s = 0; s < 1800; s++) {
      for (let i = 0; i < 20; i++) void gatedCheck(() => false);
      await vi.advanceTimersByTimeAsync(1000);
    }
    // The flood ends. Wait for one attempt to settle, advancing simulated time.
    const settle = async (p: ReturnType<typeof gatedCheck>) => {
      let out: Awaited<typeof p> | undefined;
      void p.then((x) => (out = x));
      for (let i = 0; i < 200 && !out; i++) await vi.advanceTimersByTimeAsync(1000);
      return out!;
    };
    const start = Date.now();
    let r = await settle(gatedCheck(() => true));
    // Refusals are free (not counted), so retrying always works once the <= GLOBAL_MAX_QUEUE queued guesses drained.
    while (r.refused) {
      await vi.advanceTimersByTimeAsync(1000);
      r = await settle(gatedCheck(() => true));
    }
    expect(r).toEqual({ refused: false, success: true });
    expect(Date.now() - start).toBeLessThanOrEqual((GLOBAL_MAX_QUEUE + 2) * GLOBAL_MAX_DELAY_MS);
  });
});
