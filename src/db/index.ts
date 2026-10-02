import "server-only";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";
import { seedIfEmpty } from "./seed";

export const DATA_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR ?? path.join(process.cwd(), "data"));
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
export const DB_PATH = path.join(DATA_DIR, "journal.db");

export type DB = BetterSQLite3Database<typeof schema>;

function open() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(/*turbopackIgnore: true*/ process.cwd(), "drizzle") });
  seedIfEmpty(db);
  return { db, sqlite };
}

// Opened lazily on first use (never at import / build time) and reused across hot reloads.
const g = globalThis as unknown as { __journalDb?: ReturnType<typeof open> };
const conn = () => (g.__journalDb ??= open());

function lazy<T extends object>(get: () => T): T {
  return new Proxy({} as T, {
    get(_t, prop) {
      const target = get();
      const v = Reflect.get(target, prop, target);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

export const db: DB = lazy(() => conn().db);
export const sqlite: Database.Database = lazy(() => conn().sqlite);
