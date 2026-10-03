// Edge-safe session helpers (used by proxy.ts and server code).
import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "ej_session";
const MAX_AGE_DAYS = 30;
export const SESSION_MAX_AGE = MAX_AGE_DAYS * 24 * 60 * 60;

/** The value `.env.example` used to ship; never accepted as a real password. */
const EXAMPLE_PASSWORD = "change-me";

export const NOT_CONFIGURED = "APP_PASSWORD is not configured — set a real password in .env";

/** False when APP_PASSWORD is unset/blank or still the example value (case-insensitive): login is refused. */
export function passwordConfigured(): boolean {
  const p = process.env.APP_PASSWORD?.trim().toLowerCase();
  return !!p && p !== EXAMPLE_PASSWORD;
}

/**
 * HS256 key = SHA-256(SESSION_SECRET + ":" + APP_PASSWORD), so changing EITHER invalidates every session
 * (the tokens are stateless; this is the only revocation). Web Crypto only: this runs in proxy.ts too.
 */
async function secretKey(): Promise<Uint8Array> {
  let secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    // Fail closed: the publicly known fallback exists only for `next dev`.
    if (process.env.NODE_ENV !== "development") throw new Error("SESSION_SECRET must be set (at least 32 characters)");
    secret = "dev-only-insecure-secret-change-me-please-0000";
  }
  if (!passwordConfigured()) throw new Error("APP_PASSWORD must be set to a real password");
  const bytes = new TextEncoder().encode(`${secret}:${process.env.APP_PASSWORD}`);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

/** `Secure` cookie flag: on in production and whenever COOKIE_SECURE=true; only an explicit "false" turns it off in production. */
export function cookieSecure(): boolean {
  const v = process.env.COOKIE_SECURE?.trim().toLowerCase();
  if (v === "false") return false;
  return process.env.NODE_ENV === "production" || v === "true";
}

export async function createSessionToken() {
  return new SignJWT({ sub: "owner" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_DAYS}d`)
    .sign(await secretKey());
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    await jwtVerify(token, await secretKey(), { algorithms: ["HS256"], requiredClaims: ["exp"] });
    return true;
  } catch {
    return false;
  }
}
