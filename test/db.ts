import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";

/**
 * Point the app at a fresh, migrated and seeded SQLite DB in a temp dir.
 * Call BEFORE importing anything from "@/db" (the connection is opened lazily on first use),
 * then dynamically import what you need:  `await useTempDb(); const { db } = await import("@/db");`
 */
export async function useTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ej-test-"));
  process.env.DATA_DIR = dir;
  vi.resetModules();
  delete (globalThis as { __journalDb?: unknown }).__journalDb;
  return dir;
}
