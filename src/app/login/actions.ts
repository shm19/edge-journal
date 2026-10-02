"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { passwordMatches } from "@/lib/auth";
import { clearFailures, isLocked, recordFailure, safeNext } from "@/lib/login-guard";
import { cookieSecure, createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/session";

export async function login(_prev: { error?: string } | undefined, form: FormData): Promise<{ error?: string }> {
  const h = await headers();
  const key = (h.get("x-forwarded-for")?.split(",")[0] || h.get("x-real-ip") || "local").trim();
  const now = Date.now();
  if (isLocked(key, now)) return { error: "Too many attempts — wait a minute." };

  const password = String(form.get("password") ?? "");
  if (!process.env.APP_PASSWORD) return { error: "APP_PASSWORD is not configured on the server." };
  if (!passwordMatches(password)) {
    return { error: recordFailure(key, now) ? "Too many attempts — wait a minute." : "Wrong password." };
  }
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
