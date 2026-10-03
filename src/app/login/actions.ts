"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { passwordMatches } from "@/lib/auth";
import { clearFailures, clientKey, gatedCheck, isLocked, recordFailure, safeNext } from "@/lib/login-guard";
import { cookieSecure, createSessionToken, NOT_CONFIGURED, passwordConfigured, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/session";

const TOO_MANY = "Too many attempts — wait a minute.";
const TOO_MANY_GLOBAL = "Too many attempts — wait a few minutes.";

export async function login(_prev: { error?: string } | undefined, form: FormData): Promise<{ error?: string }> {
  if (!passwordConfigured()) return { error: NOT_CONFIGURED };
  const key = clientKey(await headers());
  const now = Date.now();
  if (isLocked(key, now)) return { error: TOO_MANY };

  // Header-independent global limiter: password checks are serialised and slow down under load.
  const password = String(form.get("password") ?? "");
  const gate = await gatedCheck(() => passwordMatches(password));
  if (gate.refused) return { error: TOO_MANY_GLOBAL };
  if (!gate.success) return { error: recordFailure(key) ? TOO_MANY : "Wrong password." };
  clearFailures(key);

  let token: string;
  try {
    token = await createSessionToken();
  } catch {
    return { error: "SESSION_SECRET is not configured on the server (32+ characters)." };
  }
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  redirect(safeNext(String(form.get("next") ?? "/")));
}

export async function logout() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
