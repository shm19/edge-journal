import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { tempDb } from "../../test/db";

describe("opening the database", () => {
  it("refuses to start on a DB newer than this build, logs FATAL, and does not cache the failed connection", async () => {
    const dir = await tempDb();
    const raw = new Database(path.join(dir, "journal.db"));
    raw.exec("create table __drizzle_migrations (id integer primary key, hash text not null, created_at numeric)");
    for (let i = 0; i < 99; i++) raw.prepare("insert into __drizzle_migrations (hash, created_at) values (?, ?)").run(`h${i}`, 1_000 + i);
    raw.close();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = await import("@/db");
    expect(() => db.run("select 1")).toThrow(/newer than this version/);
    expect(log.mock.calls[0][0]).toMatch(/^FATAL: .*newer than this version/);
    expect(() => db.run("select 1")).toThrow(); // retried, not a poisoned cache
    expect(log).toHaveBeenCalledTimes(2);
    log.mockRestore();
    expect(fs.existsSync(path.join(dir, "backups"))).toBe(false);
  });
});
