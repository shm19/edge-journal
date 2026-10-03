import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrateSafely } from "./migrate";

const REAL_MIGRATIONS = path.join(process.cwd(), "drizzle");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ej-mig-"));
afterEach(() => vi.useRealTimers());

function open(dir: string) {
  const sqlite = new Database(path.join(dir, "journal.db"));
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return { sqlite, db: drizzle(sqlite) };
}

/** A throw-away migrations folder: `steps` are [sql, ...] per migration, in order. */
function folder(steps: string[], dir = tmp()) {
  fs.mkdirSync(path.join(dir, "meta"), { recursive: true });
  const entries = steps.map((sql, i) => {
    const tag = `${String(i).padStart(4, "0")}_m`;
    fs.writeFileSync(path.join(dir, `${tag}.sql`), sql);
    return { idx: i, version: "6", when: 1_700_000_000_000 + i * 1000, tag, breakpoints: true };
  });
  fs.writeFileSync(path.join(dir, "meta", "_journal.json"), JSON.stringify({ version: "7", dialect: "sqlite", entries }));
  return dir;
}
const backups = (data: string) => {
  const d = path.join(data, "backups");
  return fs.existsSync(d) ? fs.readdirSync(d).sort() : [];
};

const CREATE = "CREATE TABLE parent (id integer PRIMARY KEY, name text);--> statement-breakpoint\nCREATE TABLE child (id integer PRIMARY KEY, parent_id integer NOT NULL REFERENCES parent(id) ON DELETE CASCADE);";
// drizzle-kit's table-recreate pattern for SQLite (its PRAGMAs are no-ops inside the migrator's transaction)
const RECREATE = [
  "PRAGMA foreign_keys=OFF;--> statement-breakpoint",
  "CREATE TABLE __new_parent (id integer PRIMARY KEY, name text, extra text DEFAULT 'x' NOT NULL);--> statement-breakpoint",
  "INSERT INTO __new_parent (id, name) SELECT id, name FROM parent;--> statement-breakpoint",
  "DROP TABLE parent;--> statement-breakpoint",
  "ALTER TABLE __new_parent RENAME TO parent;--> statement-breakpoint",
  "PRAGMA foreign_keys=ON;",
].join("\n");

describe("migrateSafely", () => {
  it("applies the real migrations to a fresh DB without writing any backup", () => {
    const data = tmp();
    const { sqlite } = open(data);
    migrateSafely(sqlite, { migrationsFolder: REAL_MIGRATIONS, dataDir: data });
    expect(sqlite.prepare("select count(*) as n from __drizzle_migrations").get()).toEqual({ n: 4 });
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(backups(data)).toEqual([]);
    expect(fs.existsSync(path.join(data, "backups"))).toBe(false);
  });

  it("is a no-op (and writes no backup) when nothing is pending", () => {
    const data = tmp();
    const { sqlite } = open(data);
    migrateSafely(sqlite, { migrationsFolder: REAL_MIGRATIONS, dataDir: data });
    migrateSafely(sqlite, { migrationsFolder: REAL_MIGRATIONS, dataDir: data });
    expect(backups(data)).toEqual([]);
  });

  it("upgrades a populated older DB additively and keeps a pre-migrate copy with the old data", () => {
    const data = tmp();
    const { sqlite } = open(data);
    const mig = folder([CREATE]);
    migrateSafely(sqlite, { migrationsFolder: mig, dataDir: data });
    sqlite.exec("insert into parent values (1,'a'); insert into child values (1,1)");
    folder([CREATE, "ALTER TABLE parent ADD note text;"], mig); // a new additive migration appears (an app update)

    migrateSafely(sqlite, { migrationsFolder: mig, dataDir: data });

    expect(sqlite.prepare("select name, note from parent").all()).toEqual([{ name: "a", note: null }]);
    const [file, ...rest] = backups(data);
    expect(rest).toEqual([]);
    expect(file).toMatch(/^pre-migrate-\d+\.db$/);
    const copy = new Database(path.join(data, "backups", file), { readonly: true });
    expect(copy.prepare("select count(*) as n from parent").get()).toEqual({ n: 1 });
    expect(() => copy.prepare("select note from parent").all()).toThrow(); // taken BEFORE the migration
    copy.close();
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it.skipIf(process.platform === "win32")("creates the backup dir 0700 and the file 0600", () => {
    const data = tmp();
    const { sqlite } = open(data);
    const mig = folder([CREATE]);
    migrateSafely(sqlite, { migrationsFolder: mig, dataDir: data });
    folder([CREATE, "ALTER TABLE parent ADD note text;"], mig);
    migrateSafely(sqlite, { migrationsFolder: mig, dataDir: data });
    const dir = path.join(data, "backups");
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(dir, backups(data)[0])).mode & 0o777).toBe(0o600);
  });

  it("keeps only the newest 3 pre-migrate copies and ignores other files", () => {
    const data = tmp();
    const { sqlite } = open(data);
    const mig = folder([CREATE]);
    migrateSafely(sqlite, { migrationsFolder: mig, dataDir: data });
    const dir = path.join(data, "backups");
    fs.mkdirSync(dir, { recursive: true });
    for (const ts of [100, 200, 300, 400]) fs.writeFileSync(path.join(dir, `pre-migrate-${ts}.db`), "x");
    fs.writeFileSync(path.join(dir, "mine.db"), "keep");
    folder([CREATE, "ALTER TABLE parent ADD note text;"], mig);
    migrateSafely(sqlite, { migrationsFolder: mig, dataDir: data });
    const left = backups(data);
    expect(left).toHaveLength(4); // 3 pre-migrate + mine.db
    expect(left).toContain("mine.db");
    expect(left).not.toContain("pre-migrate-100.db");
    expect(left).not.toContain("pre-migrate-200.db");
    expect(left).toContain("pre-migrate-300.db");
    expect(left).toContain("pre-migrate-400.db"); // plus the one just written (newest timestamp)
  });

  it("does not write a second copy within the same second", () => {
    const data = tmp();
    const { sqlite } = open(data);
    vi.useFakeTimers({ now: new Date("2026-10-03T12:00:00Z"), toFake: ["Date"] });
    const mig = folder([CREATE]);
    migrateSafely(sqlite, { migrationsFolder: mig, dataDir: data });
    folder([CREATE, "ALTER TABLE parent ADD a text;"], mig);
    migrateSafely(sqlite, { migrationsFolder: mig, dataDir: data });
    folder([CREATE, "ALTER TABLE parent ADD a text;", "ALTER TABLE parent ADD b text;"], mig);
    migrateSafely(sqlite, { migrationsFolder: mig, dataDir: data });
    expect(backups(data)).toEqual([`pre-migrate-${Math.floor(Date.parse("2026-10-03T12:00:00Z") / 1000)}.db`]);
  });

  it("refuses a database that is newer than this build and leaves it untouched", () => {
    const data = tmp();
    const { sqlite } = open(data);
    migrateSafely(sqlite, { migrationsFolder: folder([CREATE, "ALTER TABLE parent ADD note text;"]), dataDir: data });
    sqlite.exec("insert into parent (id, name) values (1,'keep')");
    const older = folder([CREATE]);
    expect(() => migrateSafely(sqlite, { migrationsFolder: older, dataDir: data })).toThrow(/database is newer than this version/i);
    expect(backups(data)).toEqual([]);
    expect(sqlite.prepare("select name from parent").all()).toEqual([{ name: "keep" }]);
  });

  it("a drop-and-recreate migration does not cascade-delete child rows (and plain migrate() would)", () => {
    const steps = [CREATE, RECREATE];
    // control: drizzle's own migrate() with foreign keys ON loses the children
    const control = tmp();
    const c = open(control);
    migrate(c.db, { migrationsFolder: folder([CREATE]) });
    c.sqlite.exec("insert into parent values (1,'a'); insert into child values (1,1), (2,1)");
    migrate(c.db, { migrationsFolder: folder(steps) });
    expect(c.sqlite.prepare("select count(*) as n from child").get()).toEqual({ n: 0 });

    const data = tmp();
    const { sqlite } = open(data);
    const mig = folder([CREATE]);
    migrateSafely(sqlite, { migrationsFolder: mig, dataDir: data });
    sqlite.exec("insert into parent values (1,'a'); insert into child values (1,1), (2,1)");
    folder(steps, mig);
    migrateSafely(sqlite, { migrationsFolder: mig, dataDir: data });
    expect(sqlite.prepare("select count(*) as n from child").get()).toEqual({ n: 2 });
    expect(sqlite.prepare("select extra from parent").all()).toEqual([{ extra: "x" }]);
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("rolls back a migration that leaves broken references: error thrown, applied count and data unchanged, every restart refuses again", () => {
    const data = tmp();
    const { sqlite } = open(data);
    const mig = folder([CREATE]);
    migrateSafely(sqlite, { migrationsFolder: mig, dataDir: data });
    sqlite.exec("insert into parent values (1,'a'); insert into child values (1,1)");
    const applied = () => sqlite.prepare("select count(*) as n from __drizzle_migrations").get();
    expect(applied()).toEqual({ n: 1 });
    folder([CREATE, "DELETE FROM parent;--> statement-breakpoint\nALTER TABLE parent ADD note text;"], mig); // orphans the child (foreign keys are OFF)

    for (let attempt = 0; attempt < 2; attempt++) {
      expect(() => migrateSafely(sqlite, { migrationsFolder: mig, dataDir: data })).toThrow(/broken foreign-key reference.*child.*rolled back/);
      expect(applied()).toEqual({ n: 1 }); // not recorded, so the next start sees it pending and refuses again
      expect(sqlite.prepare("select count(*) as n from parent").get()).toEqual({ n: 1 }); // the DELETE was undone
      expect(() => sqlite.prepare("select note from parent").all()).toThrow(); // and so was the ALTER
      expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    }
    expect(backups(data).some((f) => f.startsWith("pre-migrate-"))).toBe(true);
  });

  it("does not block startup over foreign-key damage that existed before the migration", () => {
    const data = tmp();
    const { sqlite } = open(data);
    const mig = folder([CREATE]);
    migrateSafely(sqlite, { migrationsFolder: mig, dataDir: data });
    sqlite.pragma("foreign_keys = OFF");
    sqlite.exec("insert into child values (1, 99)"); // already dangling
    sqlite.pragma("foreign_keys = ON");
    folder([CREATE, "ALTER TABLE parent ADD note text;"], mig);
    expect(() => migrateSafely(sqlite, { migrationsFolder: mig, dataDir: data })).not.toThrow();
  });

  it("a failing migration rolls back, keeps the data, leaves the backup, and restores foreign keys", () => {
    const data = tmp();
    const { sqlite } = open(data);
    const mig = folder([CREATE]);
    migrateSafely(sqlite, { migrationsFolder: mig, dataDir: data });
    sqlite.exec("insert into parent values (1,'a')");
    folder([CREATE, "ALTER TABLE parent ADD note text;--> statement-breakpoint\nTHIS IS NOT SQL;"], mig);
    expect(() => migrateSafely(sqlite, { migrationsFolder: mig, dataDir: data })).toThrow();
    expect(sqlite.prepare("select name from parent").all()).toEqual([{ name: "a" }]);
    expect(() => sqlite.prepare("select note from parent").all()).toThrow(); // the ALTER was rolled back
    expect(backups(data)).toHaveLength(1);
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("does not migrate when the backup cannot be written", () => {
    const data = tmp();
    const { sqlite } = open(data);
    const mig = folder([CREATE]);
    migrateSafely(sqlite, { migrationsFolder: mig, dataDir: data });
    fs.writeFileSync(path.join(data, "backups"), "a file where the backup dir should be");
    folder([CREATE, "ALTER TABLE parent ADD note text;"], mig);
    expect(() => migrateSafely(sqlite, { migrationsFolder: mig, dataDir: data })).toThrow(/NOT migrated/);
    expect(() => sqlite.prepare("select note from parent").all()).toThrow(); // still the old schema
  });
});
