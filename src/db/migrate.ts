import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";

const KEEP_PRE_MIGRATE_BACKUPS = 3;

/**
 * Apply pending migrations without risking the data:
 * - refuse a database that is NEWER than this build (more applied migrations than the journal knows);
 * - before any pending migration on a non-empty DB, write a consistent copy (VACUUM INTO) to
 *   `<dataDir>/backups/pre-migrate-<unix ts>.db` (dir 0700, file 0600, newest 3 kept);
 * - run the migrations in one transaction with foreign keys OFF (the pragma is a no-op inside a transaction, so it is set
 *   first), so drizzle-kit's drop-and-recreate table pattern cannot cascade-delete child rows; `foreign_key_check` runs
 *   in the same transaction and a new violation rolls the whole migration back; then foreign keys ON again.
 */
export function migrateSafely(
  sqlite: Database.Database,
  opts: { migrationsFolder: string; dataDir: string },
) {
  const migrations = readMigrationFiles({ migrationsFolder: opts.migrationsFolder });
  const known = migrations.map((m) => m.folderMillis);
  const hasTable = !!sqlite.prepare("select 1 from sqlite_master where type = 'table' and name = '__drizzle_migrations'").get();
  const applied = hasTable
    ? (sqlite.prepare("select count(*) as n, max(created_at) as last from __drizzle_migrations").get() as { n: number; last: number | null })
    : { n: 0, last: null };

  if (applied.n > known.length) {
    throw new Error(
      `This database is newer than this version of Edge Journal (it has ${applied.n} migrations applied, this build knows ${known.length}). ` +
        "Update the app, or restore a backup made with this version.",
    );
  }
  // Same rule as drizzle's migrator: anything newer than the last applied migration is pending.
  const pending = known.filter((when) => applied.last === null || when > applied.last).length;
  if (pending === 0) return;

  let backup: string | undefined;
  if (applied.n > 0) backup = preMigrateBackup(sqlite, opts.dataDir);
  const violationsBefore = (sqlite.pragma("foreign_key_check") as unknown[]).length; // keep pre-existing damage from blocking startup

  // Apply the pending migrations exactly like drizzle's migrator does, but inside ONE transaction that also holds the
  // foreign-key check, so a violation rolls everything back (drizzle's own migrate() commits before we could look).
  const apply = sqlite.transaction(() => {
    for (const m of migrations) {
      if (applied.last !== null && applied.last >= m.folderMillis) continue;
      for (const stmt of m.sql) sqlite.exec(stmt);
      sqlite.prepare("insert into __drizzle_migrations (hash, created_at) values (?, ?)").run(m.hash, m.folderMillis);
    }
    const violations = sqlite.pragma("foreign_key_check") as { table: string }[];
    if (violations.length > violationsBefore) {
      const tables = [...new Set(violations.map((v) => v.table))].join(", ");
      throw new Error(
        `Migration would leave ${violations.length - violationsBefore} broken foreign-key reference(s) (tables: ${tables}); it was rolled back, the database is unchanged. Refusing to start.` +
          (backup ? ` A copy from before is in ${backup}.` : ""),
      );
    }
  });
  sqlite.exec("create table if not exists __drizzle_migrations (id integer primary key, hash text not null, created_at numeric)");
  sqlite.pragma("foreign_keys = OFF"); // a no-op inside a transaction, so it is set first
  try {
    apply();
  } finally {
    sqlite.pragma("foreign_keys = ON");
  }
}

function preMigrateBackup(sqlite: Database.Database, dataDir: string): string {
  const dir = path.join(dataDir, "backups");
  const file = path.join(dir, `pre-migrate-${Math.floor(Date.now() / 1000)}.db`);
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
    if (!fs.existsSync(file)) {
      try {
        sqlite.prepare("VACUUM INTO ?").run(file);
        fs.chmodSync(file, 0o600);
      } catch (e) {
        fs.rmSync(file, { force: true }); // never leave a half-written "backup" behind
        throw e;
      }
    }
  } catch (e) {
    throw new Error(`Could not write the pre-migration backup, so the database was NOT migrated: ${(e as Error).message}`);
  }
  const stamp = (f: string) => Number(/^pre-migrate-(\d+)\.db$/.exec(f)?.[1] ?? NaN);
  const old = fs.readdirSync(dir).filter((f) => !Number.isNaN(stamp(f))).sort((a, b) => stamp(a) - stamp(b));
  for (const f of old.slice(0, Math.max(0, old.length - KEEP_PRE_MIGRATE_BACKUPS))) fs.rmSync(path.join(dir, f), { force: true });
  return file;
}
