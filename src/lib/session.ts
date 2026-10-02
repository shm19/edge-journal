// Edge-safe session helpers (used by proxy.ts and server code).
import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "ej_session";
const MAX_AGE_DAYS = 30;
export const SESSION_MAX_AGE = MAX_AGE_DAYS * 24 * 60 * 60;

function secretKey() {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 32) return new TextEncoder().encode(secret);
  // Fail closed: the publicly known fallback exists only for `next dev`.
  if (process.env.NODE_ENV === "development") {
    return new TextEncoder().encode("dev-only-insecure-secret-change-me-please-0000");
  }
  throw new Error("SESSION_SECRET must be set (at least 32 characters)");
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
    .sign(secretKey());
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    return true;
  } catch {
    return false;
  }
}
