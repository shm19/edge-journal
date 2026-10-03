// Login helpers kept out of the "use server" file so they can be unit-tested.

/** Only allow same-origin relative paths ("/ideas?x=1"), never "//host" or "/\host". */
export function safeNext(raw: string): string {
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/";
  try {
    const u = new URL(raw, "http://local.invalid");
    // The parser collapses dot segments, so "/.//evil.com" and "/a/..//evil.com" come out as "//evil.com":
    // a protocol-relative URL that leaves the site. Check the NORMALISED result.
    const out = `${u.pathname}${u.search}`;
    return u.origin === "http://local.invalid" && !out.startsWith("//") ? out : "/";
  } catch {
    /* v8 ignore next -- new URL(path, base) cannot throw for a string that starts with "/"; defensive */
    return "/";
  }
}

// Throttle against password guessing. Two independent layers (docs/security.md):
//  1. per client key: 5 failures -> 60 s lock, then the counter resets (locks always expire);
//  2. global, header-independent: password checks run ONE AT A TIME through a small queue, with a delay ladder.
export const MAX_FAILS = 5;
export const LOCK_MS = 60_000;
export const FAIL_WINDOW_MS = 10 * 60_000; // a client's failures are forgotten this long after the last one
export const MAX_KEYS = 5_000; // cap on tracked clients; the oldest is evicted
export const MAX_KEY_LEN = 64;
// Global limiter. Within GLOBAL_WINDOW_MS the first GLOBAL_FREE_ATTEMPTS checks are immediate, then each check
// waits GLOBAL_STEP_MS longer than the last (capped at GLOBAL_MAX_DELAY_MS). Checks are serialised, so no
// number of parallel requests or header values beats ~6 guesses/min (about 360/hour). At most GLOBAL_MAX_QUEUE
// checks are running or waiting; more are turned away WITHOUT being counted, so a flood can slow the owner
// down but never locks them out: once it stops, the queue drains in at most GLOBAL_MAX_QUEUE x max delay.
export const GLOBAL_WINDOW_MS = 10 * 60_000;
export const GLOBAL_FREE_ATTEMPTS = 20;
export const GLOBAL_STEP_MS = 1_000;
export const GLOBAL_MAX_DELAY_MS = 10_000;
export const GLOBAL_MAX_QUEUE = 5;

const attempts = new Map<string, { n: number; until: number; exp: number }>();
let globalAttempts: number[] = [];

/** Throttle key: the LAST X-Forwarded-For entry (the one your own proxy appended), else x-real-ip, else "local". */
export function clientKey(h: Pick<Headers, "get">): string {
  const xff = h.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean);
  return (xff?.at(-1) ?? h.get("x-real-ip")?.trim() ?? "local").slice(0, MAX_KEY_LEN) || "local";
}

/** True while this client is locked out. An expired lock is forgotten. */
export function isLocked(key: string, now = Date.now()): boolean {
  const a = attempts.get(key);
  if (!a?.until) return false;
  if (a.until > now) return true;
  attempts.delete(key); // lock expired → fresh start
  return false;
}

/** Record a wrong password; returns true when this failure locks the client. */
export function recordFailure(key: string, now = Date.now()): boolean {
  for (const [k, v] of attempts) if (v.exp <= now) attempts.delete(k); // prune expired locks and stale counters
  const n = (attempts.get(key)?.n ?? 0) + 1;
  const locked = n >= MAX_FAILS;
  attempts.delete(key); // re-insert so Map order = least recently updated first
  attempts.set(key, { n, until: locked ? now + LOCK_MS : 0, exp: now + (locked ? LOCK_MS : FAIL_WINDOW_MS) });
  while (attempts.size > MAX_KEYS) attempts.delete(attempts.keys().next().value!);
  return locked;
}

export function clearFailures(key: string) {
  attempts.delete(key);
}

let queued = 0;
let tail: Promise<void> = Promise.resolve();

/**
 * Run one password check through the global limiter. `check` returns true when the password was right
 * (that attempt is then not counted against the budget). Resolves `{ refused: true }`, without running
 * `check` or counting anything, when too many checks are already waiting.
 */
export async function gatedCheck(check: () => boolean): Promise<{ refused: true } | { refused: false; success: boolean }> {
  if (queued >= GLOBAL_MAX_QUEUE) return { refused: true };
  queued++;
  const prev = tail;
  let release!: () => void;
  tail = new Promise<void>((r) => (release = r));
  try {
    await prev;
    globalAttempts = globalAttempts.filter((t) => t > Date.now() - GLOBAL_WINDOW_MS);
    const over = globalAttempts.length - GLOBAL_FREE_ATTEMPTS;
    if (over >= 0) await new Promise((r) => setTimeout(r, Math.min((over + 1) * GLOBAL_STEP_MS, GLOBAL_MAX_DELAY_MS)));
    globalAttempts.push(Date.now());
    const success = check();
    if (success) globalAttempts.pop(); // a successful login is not a failure: give its slot back
    return { refused: false, success };
  } finally {
    queued--;
    release();
  }
}

/** Test hook. */
export function resetThrottle() {
  attempts.clear();
  globalAttempts = [];
  queued = 0;
  tail = Promise.resolve();
}

/** Test hook. */
export function trackedKeys() {
  return attempts.size;
}
