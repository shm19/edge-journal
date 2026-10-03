import fs from "node:fs";
import path from "node:path";
import { passwordConfigured } from "@/lib/session";

/** True when `dir` exists (it is created if missing) and the current user may write to it. */
export function isWritableDir(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Startup configuration problems, as one operator-readable line each (empty = all good).
 * Pure apart from the data-dir probe; logged by `src/instrumentation.ts`, never thrown, so the app still
 * boots and the login page can explain what is wrong.
 */
export function preflightProblems(env: Record<string, string | undefined>, dataDir: string): string[] {
  const problems: string[] = [];
  if (!isWritableDir(path.join(dataDir, "uploads"))) {
    problems.push(
      `DATA_DIR ${dataDir} is not writable by this process (uid ${process.getuid?.() ?? "?"}). Fix: chown -R 1000:1000 on the data directory, or start the container as root so it fixes ownership itself.`,
    );
  }
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    problems.push("SESSION_SECRET is missing or shorter than 32 characters. Logins will fail. Generate one with: openssl rand -hex 32");
  }
  if (!passwordConfigured()) {
    problems.push("APP_PASSWORD is missing or still the placeholder 'change-me'. Set a real password in .env.");
  }
  return problems;
}
