"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { passwordMatches } from "@/lib/auth";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/session";

// Per-client throttle against password guessing: 5 failures → 60 s lock, then the counter resets.
const attempts = new Map<string, { n: number; until: number }>();
const MAX_FAILS = 5;
const LOCK_MS = 60_000;

/** Only allow same-origin relative paths ("/ideas?x=1"), never "//host" or "/\host". */
function safeNext(raw: string): string {
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/";
  try {
    const u = new URL(raw, "http://local.invalid");
    return u.origin === "http://local.invalid" ? `${u.pathname}${u.search}` : "/";
  } catch {
    return "/";
  }
}

export async function login(_prev: { error?: string } | undefined, form: FormData): Promise<{ error?: string }> {
  const h = await headers();
  const key = (h.get("x-forwarded-for")?.split(",")[0] || h.get("x-real-ip") || "local").trim();
  const now = Date.now();
  let a = attempts.get(key);
  if (a && a.until > now) return { error: "Too many attempts — wait a minute." };
  if (a && a.until && a.until <= now) a = undefined; // lock expired → fresh start

  const password = String(form.get("password") ?? "");
  if (!process.env.APP_PASSWORD) return { error: "APP_PASSWORD is not configured on the server." };
  if (!passwordMatches(password)) {
    const n = (a?.n ?? 0) + 1;
    attempts.set(key, { n, until: n >= MAX_FAILS ? now + LOCK_MS : 0 });
    return { error: n >= MAX_FAILS ? "Too many attempts — wait a minute." : "Wrong password." };
  }
  attempts.delete(key);

  const store = await cookies();
  store.set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "true" : process.env.NODE_ENV === "production",
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
