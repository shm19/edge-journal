// Spawns the real shell scripts against temp dirs (needs the sqlite3 CLI, as the scripts do).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const script = (name: string) => path.join(ROOT, "scripts", name);
const which = (cmd: string) => spawnSync("sh", ["-c", `command -v ${cmd}`], { encoding: "utf8" }).stdout.trim();
const SQLITE3 = which("sqlite3");
const hasCli = SQLITE3 !== "";
const tmp = (name = "ej-sh-") => fs.mkdtempSync(path.join(os.tmpdir(), name));

function run(file: string, args: string[], env: Record<string, string>, opts: { path?: string } = {}) {
  const r = spawnSync("/bin/sh", [script(file), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { PATH: opts.path ?? process.env.PATH ?? "", HOME: os.homedir(), ...env } as unknown as NodeJS.ProcessEnv,
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

/** A WAL-mode journal.db with `rows` rows in table t, plus uploads/<file>. */
function makeData(dir: string, rows: number, upload = "a.png") {
  fs.mkdirSync(path.join(dir, "uploads"), { recursive: true });
  fs.writeFileSync(path.join(dir, "uploads", upload), "img-" + upload);
  const db = new Database(path.join(dir, "journal.db"));
  db.pragma("journal_mode = WAL");
  db.exec("create table t (n integer)");
  for (let i = 0; i < rows; i++) db.prepare("insert into t values (?)").run(i);
  db.close();
}
const count = (file: string) => {
  const db = new Database(file, { readonly: true });
  try {
    return (db.prepare("select count(*) as n from t").get() as { n: number }).n;
  } finally {
    db.close();
  }
};
const mode = (f: string) => fs.statSync(f).mode & 0o777;

describe("docker-entrypoint.sh", () => {
  // Stub id/chown/setpriv so the root path can be exercised without being root.
  function stubs(fakeUid: string) {
    const bin = tmp("ej-ep-bin-");
    const log = path.join(bin, "log");
    const w = (n: string, body: string) => fs.writeFileSync(path.join(bin, n), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    w("id", `echo ${fakeUid}`);
    w("chown", `echo "chown $*" >> "${log}"`);
    w("setpriv", `echo "setpriv $*" >> "${log}"; shift 3; exec "$@"`);
    return { PATH: `${bin}:${process.env.PATH}`, log };
  }
  const readLog = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "");

  it("as a normal user it just runs the command and touches nothing", () => {
    const { PATH, log } = stubs("1000");
    const data = path.join(tmp(), "d");
    const r = run("docker-entrypoint.sh", ["echo", "hello world"], { DATA_DIR: data }, { path: PATH });
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe("hello world");
    expect(fs.existsSync(data)).toBe(false);
    expect(readLog(log)).toBe("");
  });

  it("as root it creates data + uploads, chowns to node, drops privileges and passes the arguments through", () => {
    const { PATH, log } = stubs("0");
    const data = path.join(tmp(), "fresh");
    const r = run("docker-entrypoint.sh", ["echo", "a b", "c"], { DATA_DIR: data }, { path: PATH });
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe("a b c");
    expect(fs.statSync(path.join(data, "uploads")).isDirectory()).toBe(true);
    expect(readLog(log).split("\n").filter(Boolean)).toEqual([
      `chown -R node:node ${data}`,
      "setpriv --reuid=node --regid=node --init-groups echo a b c",
    ]);
  });

  it("propagates the command's exit code", () => {
    const { PATH } = stubs("1000");
    expect(run("docker-entrypoint.sh", ["sh", "-c", "exit 7"], {}, { path: PATH }).code).toBe(7);
  });
});

describe.skipIf(!hasCli)("backup.sh", () => {
  it("writes a consistent 0600 db copy and an uploads archive, and leaves no temp files", () => {
    const data = tmp();
    const out = path.join(tmp(), "out");
    makeData(data, 50);
    const r = run("backup.sh", [], { DATA_DIR: data, BACKUP_DIR: out });
    expect(r.code).toBe(0);
    const files = fs.readdirSync(out);
    const dbFile = files.find((f) => /^journal-\d{8}-\d{6}-\d+\.db$/.test(f))!;
    const tar = files.find((f) => /^uploads-\d{8}-\d{6}-\d+\.tar\.gz$/.test(f))!;
    expect(files.sort()).toEqual([dbFile, tar].sort());
    expect(count(path.join(out, dbFile))).toBe(50);
    expect(mode(path.join(out, dbFile))).toBe(0o600);
    expect(mode(path.join(out, tar))).toBe(0o600);
    const listing = spawnSync("tar", ["-tzf", path.join(out, tar)], { encoding: "utf8" }).stdout;
    expect(listing).toContain("uploads/a.png");
  });

  it("fails loudly and writes nothing when journal.db is missing (no empty 4 KB backup)", () => {
    const data = tmp();
    const out = path.join(tmp(), "out");
    const r = run("backup.sh", [], { DATA_DIR: data, BACKUP_DIR: out });
    expect(r.code).toBe(1);
    expect(r.err).toContain("no database at");
    expect(r.out).not.toContain("Backup written");
    expect(fs.readdirSync(out)).toEqual([]);
    expect(fs.existsSync(path.join(data, "journal.db"))).toBe(false);
  });

  it("never overwrites an earlier backup: two runs give two distinct pairs", () => {
    const data = tmp();
    const out = tmp();
    makeData(data, 1);
    run("backup.sh", [], { DATA_DIR: data, BACKUP_DIR: out });
    run("backup.sh", [], { DATA_DIR: data, BACKUP_DIR: out });
    expect(fs.readdirSync(out).filter((f) => f.startsWith("journal-"))).toHaveLength(2);
  });

  it("keeps the newest 30 even when DATA_DIR and BACKUP_DIR contain spaces", () => {
    const data = path.join(tmp(), "my data");
    const out = path.join(tmp(), "my backups");
    makeData(data, 1);
    fs.mkdirSync(out);
    for (let i = 1; i <= 33; i++) {
      const stamp = `20200101-0000${String(i).padStart(2, "0")}-1`;
      fs.writeFileSync(path.join(out, `journal-${stamp}.db`), "x");
      fs.writeFileSync(path.join(out, `uploads-${stamp}.tar.gz`), "x");
    }
    fs.writeFileSync(path.join(out, "cron.log"), "unrelated");
    const r = run("backup.sh", [], { DATA_DIR: data, BACKUP_DIR: out });
    expect(r.code).toBe(0);
    const files = fs.readdirSync(out);
    expect(files.filter((f) => f.startsWith("journal-"))).toHaveLength(30);
    expect(files.filter((f) => f.startsWith("uploads-"))).toHaveLength(30);
    expect(files).toContain("cron.log");
    expect(files).not.toContain("journal-20200101-000001-1.db"); // oldest pruned
    expect(files).toContain("journal-20200101-000033-1.db");
  });

  it("with no uploads dir it still backs up the db and says so", () => {
    const data = tmp();
    const out = tmp();
    makeData(data, 2);
    fs.rmSync(path.join(data, "uploads"), { recursive: true });
    const r = run("backup.sh", [], { DATA_DIR: data, BACKUP_DIR: out });
    expect(r.code).toBe(0);
    expect(r.err).toContain("no uploads directory");
    expect(fs.readdirSync(out).filter((f) => f.startsWith("journal-"))).toHaveLength(1);
  });

  describe("docker-exec path (no host sqlite3; `docker compose exec` simulated)", () => {
    function noSqlitePath(containerData: string) {
      const bin = tmp("ej-bin-");
      for (const tool of ["dirname", "date", "mkdir", "rm", "mv", "tar", "find", "sort", "tail", "cat", "grep", "chmod", "sed"]) {
        const p = which(tool);
        if (p) fs.symlinkSync(p, path.join(bin, tool));
      }
      fs.writeFileSync(path.join(bin, "test"), '#!/bin/sh\n[ "$@" ]\n', { mode: 0o755 }); // `test` is a shell builtin here
      // `docker compose exec -T journal <cmd...>`: run <cmd> locally with /data pointed at containerData
      fs.writeFileSync(
        path.join(bin, "docker"),
        `#!/bin/sh\nshift 4\ncmd=$1; shift\n[ "$cmd" = sqlite3 ] && cmd="${SQLITE3}"\nargs=""\nfor a in "$@"; do set -- "$@" "$(printf %s "$a" | sed "s#/data#${containerData}#g")"; shift; done\nexec "$cmd" "$@"\n`,
        { mode: 0o755 },
      );
      return bin;
    }
    it("backs up through the container, verifies it, and removes the staging copy", () => {
      const data = tmp();
      makeData(data, 7);
      const out = tmp();
      const bin = noSqlitePath(data);
      const r = run("backup.sh", [], { BACKUP_DIR: out }, { path: bin });
      expect(r.err).toBe("");
      expect(r.code).toBe(0);
      const dbFile = fs.readdirSync(out).find((f) => f.startsWith("journal-"))!;
      expect(count(path.join(out, dbFile))).toBe(7);
      expect(fs.readdirSync(out).some((f) => f.startsWith("uploads-"))).toBe(true);
      expect(fs.readdirSync(data).filter((f) => f.startsWith("backup-tmp"))).toEqual([]);
      expect(fs.readdirSync(out).some((f) => f.endsWith(".tmp"))).toBe(false);
    });
    it("fails (and writes no backup) when the container has no database", () => {
      const data = tmp();
      const out = tmp();
      const bin = noSqlitePath(data);
      const r = run("backup.sh", [], { BACKUP_DIR: out }, { path: bin });
      expect(r.code).toBe(1);
      expect(r.err).toContain("no database in the journal container");
      expect(fs.readdirSync(out)).toEqual([]);
    });
  });
});

describe.skipIf(!hasCli)("restore.sh", () => {
  /** A backup of a 5-row DB with one screenshot, made by the real backup.sh. */
  function makeBackup() {
    const src = tmp();
    const out = tmp();
    makeData(src, 5, "from-backup.png");
    expect(run("backup.sh", [], { DATA_DIR: src, BACKUP_DIR: out }).code).toBe(0);
    const files = fs.readdirSync(out);
    return {
      db: path.join(out, files.find((f) => f.startsWith("journal-"))!),
      tar: path.join(out, files.find((f) => f.startsWith("uploads-"))!),
    };
  }

  it("restores db + uploads, keeps the replaced DB, and deletes the stale -wal/-shm", () => {
    const b = makeBackup();
    const data = tmp();
    makeData(data, 99, "current.png");
    fs.writeFileSync(path.join(data, "journal.db-wal"), "stale wal that would corrupt the restored db");
    fs.writeFileSync(path.join(data, "journal.db-shm"), "stale shm");
    const r = run("restore.sh", [b.db, b.tar], { DATA_DIR: data });
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(fs.existsSync(path.join(data, "journal.db-wal"))).toBe(false); // checked before the test itself opens the DB
    expect(fs.existsSync(path.join(data, "journal.db-shm"))).toBe(false);
    expect(count(path.join(data, "journal.db"))).toBe(5);
    const kept = fs.readdirSync(data).filter((f) => /^journal\.db\.pre-restore-\d{8}-\d{6}-\d+$/.test(f));
    expect(kept).toHaveLength(1);
    expect(count(path.join(data, kept[0]))).toBe(99);
    expect(r.out).toContain(kept[0]);
    expect(fs.readFileSync(path.join(data, "uploads", "from-backup.png"), "utf8")).toBe("img-from-backup.png");
    expect(fs.existsSync(path.join(data, "uploads", "current.png"))).toBe(true); // merged, nothing deleted
    const check = spawnSync(SQLITE3, [path.join(data, "journal.db"), "pragma integrity_check"], { encoding: "utf8" });
    expect(check.stdout.trim()).toBe("ok");
  });

  it("a second restore keeps the data from before the first one, and moves the WAL files along with the replaced DB", () => {
    const b = makeBackup();
    const data = tmp();
    makeData(data, 11);
    expect(run("restore.sh", [b.db], { DATA_DIR: data }).code).toBe(0);
    // live DB now has 5 rows; give it a (fake) WAL so we can see it travel with the kept copy
    fs.writeFileSync(path.join(data, "journal.db-wal"), "");
    const r = run("restore.sh", [b.db], { DATA_DIR: data });
    expect(r.code).toBe(0);
    const kept = fs.readdirSync(data).filter((f) => /^journal\.db\.pre-restore-[\d-]+$/.test(f)).sort();
    expect(kept).toHaveLength(2); // the first restore's copy was not destroyed
    expect(kept.map((f) => count(path.join(data, f))).sort((a, b) => a - b)).toEqual([5, 11]);
    expect(fs.existsSync(path.join(data, "journal.db-wal"))).toBe(false);
  });

  it("restores into an empty data dir (new server) and works without an uploads archive", () => {
    const b = makeBackup();
    const data = path.join(tmp(), "new-data");
    const r = run("restore.sh", [b.db], { DATA_DIR: data });
    expect(r.code).toBe(0);
    expect(count(path.join(data, "journal.db"))).toBe(5);
    expect(fs.readdirSync(data).some((f) => f.includes("pre-restore"))).toBe(false);
    expect(r.out).toContain("screenshots were not touched");
  });

  it("aborts non-zero on a corrupt backup and leaves the current DB untouched", () => {
    const data = tmp();
    makeData(data, 3);
    const bad = path.join(tmp(), "bad.db");
    fs.writeFileSync(bad, Buffer.alloc(8192, 7));
    const r = run("restore.sh", [bad], { DATA_DIR: data });
    expect(r.code).toBe(1);
    expect(count(path.join(data, "journal.db"))).toBe(3);
    expect(fs.readdirSync(data).some((f) => f.includes("pre-restore"))).toBe(false);
    expect(fs.readdirSync(data).filter((f) => f.startsWith(".restore-"))).toEqual([]);
  });

  it("refuses bad arguments and a missing backup", () => {
    const data = tmp();
    expect(run("restore.sh", [], { DATA_DIR: data }).code).toBe(1);
    const r = run("restore.sh", [path.join(data, "nope.db")], { DATA_DIR: data });
    expect(r.code).toBe(1);
    expect(r.err).toContain("not found");
  });

  it("refuses an uploads archive with paths outside uploads/ before changing anything", () => {
    const b = makeBackup();
    const data = tmp();
    makeData(data, 3);
    const evil = tmp();
    fs.writeFileSync(path.join(evil, "x.txt"), "x");
    const tarFile = path.join(tmp(), "evil.tar.gz");
    spawnSync("tar", ["-czf", tarFile, "-C", evil, "x.txt"]);
    const r = run("restore.sh", [b.db, tarFile], { DATA_DIR: data });
    expect(r.code).toBe(1);
    expect(r.err).toContain("outside uploads/");
    expect(count(path.join(data, "journal.db"))).toBe(3); // DB untouched
  });

  it("refuses to run while the container is up, unless RESTORE_FORCE=1", () => {
    const b = makeBackup();
    const data = tmp();
    makeData(data, 3);
    const bin = tmp("ej-docker-");
    fs.writeFileSync(path.join(bin, "docker"), "#!/bin/sh\necho abc123\n", { mode: 0o755 });
    const PATH = `${bin}:${process.env.PATH}`;
    const refused = run("restore.sh", [b.db], { DATA_DIR: data }, { path: PATH });
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("app is running");
    expect(count(path.join(data, "journal.db"))).toBe(3);
    const forced = run("restore.sh", [b.db], { DATA_DIR: data, RESTORE_FORCE: "1" }, { path: PATH });
    expect(forced.code).toBe(0);
    expect(count(path.join(data, "journal.db"))).toBe(5);
  });
});
