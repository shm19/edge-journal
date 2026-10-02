import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySessionToken } from "./session";

/** Constant-time password check against APP_PASSWORD. */
export function passwordMatches(input: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return false;
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function isAuthenticated(): Promise<boolean> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

/** Guard for server components and server actions. */
export async function requireAuth() {
  if (!(await isAuthenticated())) redirect("/login");
}
