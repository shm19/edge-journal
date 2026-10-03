// Login helpers kept out of the "use server" file so they can be unit-tested.

/** Only allow same-origin relative paths ("/ideas?x=1"), never "//host" or "/\host". */
export function safeNext(raw: string): string {
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/";
  try {
    const u = new URL(raw, "http://local.invalid");
    return u.origin === "http://local.invalid" ? `${u.pathname}${u.search}` : "/";
  } catch {
    /* v8 ignore next -- new URL(path, base) cannot throw for a string that starts with "/"; defensive */
    return "/";
  }
}

// Per-client throttle against password guessing: 5 failures → 60 s lock, then the counter resets.
export const MAX_FAILS = 5;
export const LOCK_MS = 60_000;
const attempts = new Map<string, { n: number; until: number }>();

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
  for (const [k, v] of attempts) if (v.until && v.until <= now) attempts.delete(k); // prune
  const n = (attempts.get(key)?.n ?? 0) + 1;
  const locked = n >= MAX_FAILS;
  attempts.set(key, { n, until: locked ? now + LOCK_MS : 0 });
  return locked;
}

export function clearFailures(key: string) {
  attempts.delete(key);
}

/** Test hook. */
export function resetThrottle() {
  attempts.clear();
}
