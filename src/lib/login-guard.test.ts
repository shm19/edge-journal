import { beforeEach, describe, expect, it } from "vitest";
import { clearFailures, isLocked, LOCK_MS, MAX_FAILS, recordFailure, resetThrottle, safeNext } from "./login-guard";

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
