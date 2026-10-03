// Simulations of the SSH / no-Docker deployment tooling (scripts/server.sh, deploy/*.sh) in temp dirs: no root, no systemd,
// no real server. The server side runs for real against a fake ROOT prefix with a stub `systemctl` that starts a tiny node
// "app" (real SQLite, /api/health) from `current`; `ssh` / `scp` / `sudo` stubs run the "remote" commands locally.
// Not covered here (see docs/deployment.md): real systemd, apt, sudo, the Linux build, a real ssh host.
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, afterEach, describe, expect, it } from "vitest";

const REPO = process.cwd();
const which = (cmd: string) => spawnSync("sh", ["-c", `command -v ${cmd}`], { encoding: "utf8" }).stdout.trim();
const missing = ["sqlite3", "curl", "git", "tar", "gzip", "node"].filter((c) => !which(c));
const NODE_DIR = path.dirname(process.execPath);
const BASE_PATH = `${NODE_DIR}:${process.env.PATH ?? ""}`;
// The simulation blocks skip themselves when the machine lacks a tool the real scripts need (sqlite3, curl, git, tar, gzip, node).
const d = describe.skipIf(missing.length > 0);

const FAKE_APP = `
const http = require("http"), fs = require("fs"), path = require("path");
const Database = require("better-sqlite3");
const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "app.json"), "utf8"));
const dataDir = process.env.DATA_DIR;
function healthy() {
  if (cfg.down) return false; // never touches the database
  fs.mkdirSync(path.join(dataDir, "uploads"), { recursive: true });
  const db = new Database(path.join(dataDir, "journal.db"));
  try {
    db.pragma("journal_mode = WAL");
    const uv = db.pragma("user_version", { simple: true });
    if (uv > cfg.schema) return false; // "database is newer than this version"
    if (uv < cfg.schema) { db.exec("create table if not exists t (n integer)"); db.pragma("user_version = " + cfg.schema); }
    return !cfg.broken; // broken: migrates, then reports unhealthy
  } finally { db.close(); }
}
http.createServer((req, res) => {
  let ok = false;
  try { ok = healthy(); } catch (e) { console.error(String(e)); }
  res.statusCode = ok ? 200 : 503;
  res.end(ok ? '{"ok":true}' : '{"ok":false}');
}).listen(Number(process.env.PORT), "127.0.0.1");
`;

const SYSTEMCTL = `#!/bin/sh
RUN="$ROOT/run"; mkdir -p "$RUN"
stop() {
  if [ -f "$RUN/pid" ]; then
    p=$(cat "$RUN/pid"); kill "$p" 2>/dev/null || true
    i=0; while kill -0 "$p" 2>/dev/null && [ $i -lt 50 ]; do sleep 0.1; i=$((i+1)); done
    rm -f "$RUN/pid"
  fi
}
start() {
  stop
  cd "$ROOT/opt/edge-journal/current/" || exit 1
  PORT=$FAKE_PORT NODE_PATH=$FAKE_NODE_PATH node "$FAKE_APP" </dev/null >>"$RUN/app.log" 2>&1 &
  echo $! > "$RUN/pid"
}
case "$1" in restart|start) start ;; stop) stop ;; show) echo ActiveState=active; echo SubState=running ;; esac
exit 0
`;
const NPM = `#!/bin/sh
echo "$* | cwd=$(pwd) NODE_OPTIONS=\${NODE_OPTIONS:-} HOME=\${HOME:-} DATA_DIR=\${DATA_DIR:-} CI=\${CI:-}" >> "$ROOT/npm.log"
[ -z "\${NPM_SLEEP:-}" ] || sleep "$NPM_SLEEP"
if [ "$1" = run ] && [ -f fail-build ]; then echo "build exploded" >&2; exit 1; fi
case "$1" in ci) mkdir -p node_modules ;; run) mkdir -p .next ;; esac
`;
const SSH = `#!/bin/sh
echo "ssh $*" >> "$STUB_LOG"
noin=0
while [ $# -gt 0 ]; do case "$1" in -p|-i|-o|-L) shift 2 ;; -n) noin=1; shift ;; -*) shift ;; *) break ;; esac; done
shift # the host
cd "$FAKE_HOME" || exit 1
cmd=$(printf '%s' "$*" | sed "s#/etc/edge-journal/#$ROOT/etc/edge-journal/#g") # the one absolute server path the laptop script reads
if [ $noin = 1 ]; then exec sh -c "$cmd" </dev/null; fi
exec sh -c "$cmd"
`;
const SCP = `#!/bin/sh
echo "scp $*" >> "$STUB_LOG"
while [ $# -gt 0 ]; do case "$1" in -P|-i|-o) shift 2 ;; -*) shift ;; *) break ;; esac; done
map() { case "$1" in *@*:*) echo "$FAKE_HOME/\${1#*:}" ;; *) echo "$1" ;; esac; }
for a in "$@"; do last=$a; done
dest=$(map "$last"); i=1
for a in "$@"; do [ $i -eq $# ] && break; cp "$(map "$a")" "$dest" || exit 1; i=$((i + 1)); done
`;
const SUDO = `#!/bin/sh
exec "$@"
`;
const INIT_NODE = `#!/bin/sh
case "$1" in -p) echo 22 ;; -v) echo v22.0.0 ;; esac
`;
const DPKG = `#!/bin/sh
echo "Status: install ok installed"
`;

const worlds: { dir: string; root: string }[] = [];
function stopApps() {
  for (const w of worlds) {
    const pid = path.join(w.root, "run", "pid");
    if (!fs.existsSync(pid)) continue;
    try {
      process.kill(Number(fs.readFileSync(pid, "utf8")));
    } catch {
      /* already gone */
    }
    fs.rmSync(pid, { force: true });
  }
  spawnSync("sleep", ["0.3"]); // let the port go
}
afterEach(stopApps);
afterAll(() => {
  stopApps();
  for (const w of worlds) fs.rmSync(w.dir, { recursive: true, force: true });
});

let portCounter = 0; // 3811-3829 are used for these simulations (3810-3830 are reserved); an app is stopped after each test, so ports are reused
const sha = (f: string) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const mode = (f: string) => fs.statSync(f).mode & 0o777;
const sh = (file: string, body: string) => fs.writeFileSync(file, body, { mode: 0o755 });

function dbInfo(file: string) {
  const db = new Database(file, { readonly: true });
  try {
    const uv = db.pragma("user_version", { simple: true }) as number;
    const rows = (db.prepare("select count(*) as n from t").get() as { n: number }).n;
    return { uv, rows };
  } finally {
    db.close();
  }
}

function world() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ej-dep-"));
  const root = path.join(dir, "root");
  const bin = path.join(dir, "bin");
  const home = path.join(dir, "home");
  for (const p of [root, bin, home]) fs.mkdirSync(p, { recursive: true });
  worlds.push({ dir, root });
  const port = 3811 + (portCounter++ % 19);
  sh(path.join(bin, "systemctl"), SYSTEMCTL);
  sh(path.join(bin, "npm"), NPM);
  sh(path.join(bin, "ssh"), SSH);
  sh(path.join(bin, "scp"), SCP);
  sh(path.join(bin, "sudo"), SUDO);
  fs.writeFileSync(path.join(bin, "fake-app.js"), FAKE_APP);
  const initBin = path.join(dir, "initbin"); // only for server-setup.sh: stubbed dpkg + node
  fs.mkdirSync(initBin);
  sh(path.join(initBin, "dpkg"), DPKG);
  sh(path.join(initBin, "node"), INIT_NODE);

  const data = path.join(root, "var/lib/edge-journal");
  const backups = path.join(root, "var/backups/edge-journal");
  const preDeploy = path.join(backups, "pre-deploy");
  const envFile = path.join(root, "etc/edge-journal/edge-journal.env");
  const stubLog = path.join(dir, "stubs.log");
  const env = (extra: Record<string, string> = {}) =>
    ({
      PATH: BASE_PATH,
      HOME: os.homedir(),
      ROOT: root,
      NO_ROOT: "1",
      SYSTEMCTL: path.join(bin, "systemctl"),
      RUNUSER: "env",
      NPM: path.join(bin, "npm"),
      JOURNALCTL: "true",
      HEALTH_URL: `http://127.0.0.1:${port}/api/health`,
      HEALTH_TIMEOUT: "8",
      HEALTH_INTERVAL: "0.3",
      FAST_FAIL_503: "2",
      MIN_DISK_MB: "1",
      MEMINFO: "/nonexistent",
      DATA_DIR: data,
      FAKE_PORT: String(port),
      FAKE_APP: path.join(bin, "fake-app.js"),
      FAKE_NODE_PATH: path.join(REPO, "node_modules"),
      FAKE_HOME: home,
      STUB_LOG: stubLog,
      ASSUME_YES: "1",
      ...extra,
    }) as unknown as NodeJS.ProcessEnv;

  fs.mkdirSync(path.dirname(envFile), { recursive: true });
  fs.writeFileSync(envFile, "APP_PASSWORD=x\nSESSION_SECRET=y\nPORT=" + port + "\n", { mode: 0o600 });

  /** A release tarball as `git archive` + RELEASE would make it. */
  function release(id: string, o: { schema?: number; down?: boolean; broken?: boolean; failBuild?: boolean; bare?: boolean } = {}) {
    const src = path.join(dir, `rel-${id}`);
    fs.mkdirSync(path.join(src, "scripts"), { recursive: true });
    if (!o.bare) {
      fs.writeFileSync(path.join(src, "package.json"), "{}");
      for (const f of ["backup.sh", "restore.sh"]) fs.copyFileSync(path.join(REPO, "scripts", f), path.join(src, "scripts", f));
    }
    fs.writeFileSync(path.join(src, "app.json"), JSON.stringify({ schema: o.schema ?? 1, down: o.down, broken: o.broken }));
    fs.writeFileSync(path.join(src, "RELEASE"), `commit=abc${id}\nid=${id}\n`);
    if (o.failBuild) fs.writeFileSync(path.join(src, "fail-build"), "");
    const tgz = path.join(dir, `release-${id}.tar.gz`);
    spawnSync("tar", ["-czf", tgz, "-C", src, "."]);
    return tgz;
  }
  const script = (name: string) => path.join(REPO, "deploy", name);
  const run = (name: string, args: string[], extra: Record<string, string> = {}, input?: string) => {
    const r = spawnSync("sh", [script(name), ...args], { cwd: home, encoding: "utf8", env: env(extra), input, timeout: 120_000 });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  const deploy = (id: string, tgz: string, extra: Record<string, string> = {}) => run("remote-deploy.sh", [id, tgz], extra);
  const admin = (args: string[], extra: Record<string, string> = {}) => run("remote-admin.sh", args, extra);
  const health = () => spawnSync("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", `http://127.0.0.1:${port}/api/health`], { encoding: "utf8" }).stdout;
  const current = () => path.basename(fs.readlinkSync(path.join(root, "opt/edge-journal/current")));
  const releases = () => fs.readdirSync(path.join(root, "opt/edge-journal/releases")).sort();
  const dbFile = path.join(data, "journal.db");
  /** What the running app "writes": rows in table t (plus a screenshot). */
  const addRows = (n: number) => {
    const db = new Database(dbFile);
    for (let i = 0; i < n; i++) db.prepare("insert into t values (?)").run(i);
    db.close();
    fs.writeFileSync(path.join(data, "uploads", "shot.png"), "png-bytes");
  };
  const preDeployDbs = () => (fs.existsSync(preDeploy) ? fs.readdirSync(preDeploy).filter((f) => /^journal-.*\.db$/.test(f)).sort() : []);
  return { dir, root, bin, initBin, home, port, data, backups, preDeploy, envFile, stubLog, env, release, run, deploy, admin, health, current, releases, dbFile, addRows, preDeployDbs, script };
}

describe("syntax of every script", () => {
  const files = ["scripts/server.sh", "deploy/lib.sh", "deploy/remote-deploy.sh", "deploy/remote-admin.sh", "deploy/server-setup.sh", "deploy/doctor.sh"];
  for (const shell of ["sh", "bash --posix", "dash"]) {
    const bin = shell.split(" ")[0];
    it.skipIf(!which(bin))(`${shell} -n accepts them`, () => {
      for (const f of files) {
        const r = spawnSync(bin, [...shell.split(" ").slice(1), "-n", path.join(REPO, f)], { encoding: "utf8" });
        expect(r.status, `${shell} -n ${f}: ${r.stderr}`).toBe(0);
      }
    });
  }
  it("package.json has the one convenience alias", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
    expect(pkg.scripts.server).toBe("sh scripts/server.sh");
  });
  it("the systemd units carry the settings the design promises", () => {
    const unit = fs.readFileSync(path.join(REPO, "deploy/edge-journal.service"), "utf8");
    for (const s of ["User=edge-journal", "EnvironmentFile=/etc/edge-journal/edge-journal.env", "NODE_ENV=production", "DATA_DIR=/var/lib/edge-journal", "WorkingDirectory=/opt/edge-journal/current", "Restart=on-failure", "TimeoutStopSec=30", "NoNewPrivileges=true", "PrivateTmp=true", "ProtectSystem=strict", "ProtectHome=true", "next start -H $HOST -p $PORT"]) {
      expect(unit, s).toContain(s);
    }
    const timer = fs.readFileSync(path.join(REPO, "deploy/edge-journal-backup.timer"), "utf8");
    expect(timer).toContain("Persistent=true");
    expect(timer).toContain("03:00");
    expect(fs.readFileSync(path.join(REPO, "deploy/edge-journal-backup.service"), "utf8")).toContain("User=edge-journal");
  });
});

d("remote-deploy.sh (server side, simulated: temp ROOT, stub systemctl/npm, fake app on real SQLite)", () => {
  it("(1) a first deploy builds as the service user, creates the layout and the symlink, and needs no backup", () => {
    const w = world();
    const r = w.deploy("20260101-000000-aaa", w.release("20260101-000000-aaa"));
    expect(r.out).toContain("DEPLOYED");
    expect(r.code).toBe(0);
    expect(w.current()).toBe("20260101-000000-aaa");
    expect(w.health()).toBe("200");
    expect(fs.existsSync(path.join(w.root, "opt/edge-journal/releases/20260101-000000-aaa/.next/cache"))).toBe(true);
    expect(fs.existsSync(path.join(w.root, "opt/edge-journal/releases/20260101-000000-aaa/.build-data"))).toBe(false);
    expect(fs.existsSync(path.join(w.root, "opt/edge-journal/.lock"))).toBe(false);
    expect(w.preDeployDbs()).toEqual([]); // there was no database yet
    // npm ran in order, in the release dir, with the memory cap and a throwaway DATA_DIR (never the live one)
    const calls = fs.readFileSync(path.join(w.root, "npm.log"), "utf8").trim().split("\n");
    expect(calls.map((c) => c.split(" | ")[0].split(" ").slice(0, 2).join(" "))).toEqual(["ci --no-audit", "run build", "prune --omit=dev"]);
    for (const c of calls) {
      expect(c).toContain("NODE_OPTIONS=--max-old-space-size=1536");
      expect(c).toContain("CI=1");
      expect(c).toContain(`HOME=${path.join(w.root, "opt/edge-journal/.home")}`);
      expect(c).toContain("DATA_DIR=" + path.join(w.root, "opt/edge-journal/releases/20260101-000000-aaa/.build-data"));
    }
    expect(fs.readFileSync(path.join(w.root, "var/log/edge-journal-deploy.log"), "utf8")).toContain("first deploy");
  }, 60_000);

  it("(2) a second deploy takes a verified backup of the seeded database first, then swaps", () => {
    const w = world();
    expect(w.deploy("20260101-000000-aaa", w.release("20260101-000000-aaa")).code).toBe(0);
    w.addRows(5);
    const r = w.deploy("20260102-000000-bbb", w.release("20260102-000000-bbb", { schema: 2 }));
    expect(r.code).toBe(0);
    expect(w.current()).toBe("20260102-000000-bbb");
    const [bk] = w.preDeployDbs();
    expect(bk).toBeDefined();
    expect(dbInfo(path.join(w.preDeploy, bk))).toEqual({ uv: 1, rows: 5 }); // the state BEFORE the new migration
    expect(dbInfo(w.dbFile)).toEqual({ uv: 2, rows: 5 }); // migrated live DB, nothing lost
    const up = fs.readdirSync(w.preDeploy).find((f) => f.startsWith("uploads-"));
    expect(up).toBeDefined();
    expect(spawnSync("tar", ["-tzf", path.join(w.preDeploy, up as string)], { encoding: "utf8" }).stdout).toContain("uploads/shot.png");
    expect(mode(w.preDeploy)).toBe(0o700);
    expect(r.out).toContain(bk);
    expect(w.releases()).toEqual(["20260101-000000-aaa", "20260102-000000-bbb"]);
  }, 60_000);

  it("(3) a release that never becomes healthy is rolled back automatically; the data is byte-identical", () => {
    const w = world();
    w.deploy("20260101-000000-aaa", w.release("20260101-000000-aaa", { schema: 2 }));
    w.addRows(3);
    const before = { db: sha(w.dbFile), shot: sha(path.join(w.data, "uploads/shot.png")) };
    const r = w.deploy("20260102-000000-bbb", w.release("20260102-000000-bbb", { down: true }));
    expect(r.code).toBe(2);
    expect(r.out).toContain("ROLLED BACK");
    expect(w.current()).toBe("20260101-000000-aaa");
    expect(w.health()).toBe("200");
    expect({ db: sha(w.dbFile), shot: sha(path.join(w.data, "uploads/shot.png")) }).toEqual(before);
    expect(w.releases()).toEqual(["20260101-000000-aaa"]); // the failed build is gone, the good one is kept
    expect(w.preDeployDbs()).toHaveLength(1); // the backup stays
  }, 60_000);

  it("(4) a release that migrates the DB and then fails: the old code refuses the newer DB, so the pre-deploy backup is restored and nothing is lost", () => {
    const w = world();
    w.deploy("20260101-000000-aaa", w.release("20260101-000000-aaa", { schema: 2 }));
    w.addRows(7);
    const r = w.deploy("20260102-000000-bbb", w.release("20260102-000000-bbb", { schema: 3, broken: true }));
    expect(r.code).toBe(3);
    expect(r.out).toContain("ROLLED BACK AND RESTORED");
    expect(w.current()).toBe("20260101-000000-aaa");
    expect(w.health()).toBe("200");
    expect(dbInfo(w.dbFile)).toEqual({ uv: 2, rows: 7 }); // back to the pre-deploy state
    // the database as the failed release left it is kept, newer schema and all
    const kept = fs.readdirSync(w.data).filter((f) => /^journal\.db\.pre-restore-[^-]+-[^-]+-\d+$/.test(f));
    expect(kept).toHaveLength(1);
    expect(dbInfo(path.join(w.data, kept[0]))).toEqual({ uv: 3, rows: 7 });
    expect(w.preDeployDbs()).toHaveLength(1);
    expect(fs.existsSync(path.join(w.data, "uploads/shot.png"))).toBe(true);
  }, 90_000);

  it("(5) a second deploy cannot overlap a running one; a stale lock is taken over", () => {
    const w = world();
    const slow = spawn("sh", [w.script("remote-deploy.sh"), "20260101-000000-aaa", w.release("20260101-000000-aaa")], { cwd: w.home, env: w.env({ NPM_SLEEP: "2" }), stdio: "ignore" });
    const finished = new Promise<number | null>((res) => slow.on("close", res));
    spawnSync("sleep", ["1"]); // let it take the lock and start its (slow) npm
    const second = w.deploy("20260101-000001-bbb", w.release("20260101-000001-bbb"));
    expect(second.code).toBe(1);
    expect(second.out).toContain("another deploy or restore is running");
    expect(w.releases().includes("20260101-000001-bbb")).toBe(false);
    return finished.then((code) => {
      expect(code).toBe(0);
      expect(w.current()).toBe("20260101-000000-aaa");
      // a lock left behind by a dead process does not block forever
      fs.symlinkSync("999999", path.join(w.root, "opt/edge-journal/.lock"));
      const third = w.deploy("20260102-000000-ccc", w.release("20260102-000000-ccc"));
      expect(third.out).toContain("stale lock");
      expect(third.code).toBe(0);
    });
  }, 90_000);

  it("(6) pruning keeps the newest two releases and never touches data, backups or the env file", () => {
    const w = world();
    const ids = ["20260101-000000-a", "20260102-000000-b", "20260103-000000-c", "20260104-000000-d"];
    for (const [i, id] of ids.entries()) {
      expect(w.deploy(id, w.release(id, { schema: 1 })).code).toBe(0);
      if (i === 0) w.addRows(4);
    }
    expect(w.releases()).toEqual([ids[2], ids[3]]);
    expect(w.current()).toBe(ids[3]);
    expect(dbInfo(w.dbFile)).toEqual({ uv: 1, rows: 4 });
    expect(w.preDeployDbs().length).toBe(3); // one per deploy that had a database
    expect(fs.readFileSync(w.envFile, "utf8")).toContain("SESSION_SECRET=y");
    expect(fs.existsSync(path.join(w.data, "uploads/shot.png"))).toBe(true);
  }, 120_000);

  it("a failed build, a bad archive and a failing backup abort before anything live changes", () => {
    const w = world();
    expect(w.deploy("20260101-000000-aaa", w.release("20260101-000000-aaa")).code).toBe(0);
    w.addRows(2);
    const snap = sha(w.dbFile);
    const build = w.deploy("20260102-000000-bbb", w.release("20260102-000000-bbb", { failBuild: true }));
    expect(build.code).toBe(1);
    expect(build.out).toContain("the build failed");
    const bare = w.deploy("20260103-000000-ccc", w.release("20260103-000000-ccc", { bare: true }));
    expect(bare.code).toBe(1);
    expect(bare.out).toContain("does not look like an Edge Journal release");
    // a corrupt database: the backup cannot be verified, so the deploy is refused (the corrupt file is left alone)
    fs.writeFileSync(w.dbFile, "this is not a sqlite database at all, just bytes".repeat(50));
    const corrupt = sha(w.dbFile);
    const bk = w.deploy("20260104-000000-ddd", w.release("20260104-000000-ddd"));
    expect(bk.code).toBe(1);
    expect(bk.out).toContain("pre-deploy backup failed");
    expect(sha(w.dbFile)).toBe(corrupt);
    expect(w.current()).toBe("20260101-000000-aaa");
    expect(w.releases()).toEqual(["20260101-000000-aaa"]);
    expect(snap).not.toBe(corrupt);
  }, 90_000);

  it("a failed first deploy leaves the new release in place and says so (exit 6)", () => {
    const w = world();
    const r = w.deploy("20260101-000000-aaa", w.release("20260101-000000-aaa", { down: true }));
    expect(r.code).toBe(6);
    expect(r.out).toContain("FIRST DEPLOY FAILED");
  }, 60_000);

  it("refuses to run without the env file or with a bad release id", () => {
    const w = world();
    fs.rmSync(w.envFile);
    const tgz = w.release("20260101-000000-aaa");
    expect(w.deploy("20260101-000000-aaa", tgz).out).toContain("Run './scripts/server.sh init' first");
    expect(w.deploy("../evil", tgz).code).toBe(1);
  }, 60_000);
});

d("remote-admin.sh (rollback, restore, backups, status)", () => {
  it("rollback goes back one release; a newer DB offers the pre-deploy restore (exit 5), which loses nothing", () => {
    const w = world();
    w.deploy("20260101-000000-aaa", w.release("20260101-000000-aaa", { schema: 1 }));
    w.addRows(6);
    w.deploy("20260102-000000-bbb", w.release("20260102-000000-bbb", { schema: 2 }));
    // plain rollback is refused by the old code: the DB was migrated to 2
    const r = w.admin(["rollback"]);
    expect(r.code).toBe(5);
    expect(r.out).toContain("pre-deploy backup");
    expect(w.current()).toBe("20260101-000000-aaa");
    const fix = w.admin(["restore-predeploy"]);
    expect(fix.code).toBe(0);
    expect(w.health()).toBe("200");
    expect(dbInfo(w.dbFile)).toEqual({ uv: 1, rows: 6 });
    expect(fs.readdirSync(w.data).some((f) => f.startsWith("journal.db.pre-restore-"))).toBe(true);
  }, 90_000);

  it("rollback works without a prompt when the old code accepts the DB", () => {
    const w = world();
    w.deploy("20260101-000000-aaa", w.release("20260101-000000-aaa", { schema: 1 }));
    w.deploy("20260102-000000-bbb", w.release("20260102-000000-bbb", { schema: 1 }));
    expect(w.admin(["rollback"]).code).toBe(0);
    expect(w.current()).toBe("20260101-000000-aaa");
    expect(w.admin(["rollback"]).out).toContain("no release older");
  }, 60_000);

  it("restore keeps the current DB as .pre-restore-*, archives the current uploads, merges the screenshots and starts the app", () => {
    const w = world();
    w.deploy("20260101-000000-aaa", w.release("20260101-000000-aaa"));
    w.addRows(3);
    expect(w.admin(["backup"]).out).toContain("BACKUP journal-");
    const bk = fs.readdirSync(w.backups).find((f) => f.startsWith("journal-")) as string;
    const up = fs.readdirSync(w.backups).find((f) => f.startsWith("uploads-")) as string;
    w.addRows(10); // later data
    fs.copyFileSync(path.join(w.backups, bk), path.join(w.home, "old.db"));
    fs.copyFileSync(path.join(w.backups, up), path.join(w.home, "old-uploads.tar.gz"));
    const r = w.admin(["restore", "old.db", "old-uploads.tar.gz"]);
    expect(r.code).toBe(0);
    expect(dbInfo(w.dbFile).rows).toBe(3);
    const names = fs.readdirSync(w.data);
    const kept = names.find((f) => /^journal\.db\.pre-restore-/.test(f)) as string;
    expect(dbInfo(path.join(w.data, kept)).rows).toBe(13);
    expect(names.some((f) => f.startsWith("uploads.pre-restore-"))).toBe(true);
    expect(w.health()).toBe("200");
    // a corrupt file is refused before anything is touched
    fs.writeFileSync(path.join(w.home, "bad.db"), "garbage".repeat(100));
    const before = sha(w.dbFile);
    expect(w.admin(["restore", "bad.db"]).code).toBe(1);
    expect(sha(w.dbFile)).toBe(before);
    // a second restore never overwrites the first safety copy
    w.admin(["restore", "old.db"]);
    expect(fs.readdirSync(w.data).filter((f) => /^journal\.db\.pre-restore-[^-]+-[^-]+-\d+$/.test(f)).length).toBeGreaterThanOrEqual(2);
  }, 90_000);

  it("stage-backups packs the newest N databases and the newest uploads archive, owner-readable only", () => {
    const w = world();
    w.deploy("20260101-000000-aaa", w.release("20260101-000000-aaa"));
    w.addRows(1);
    for (let i = 0; i < 3; i++) {
      w.admin(["backup"]);
      spawnSync("sleep", ["1"]);
    }
    const r = w.admin(["stage-backups", "2", path.join(w.home, "pull.tar")]);
    expect(r.code).toBe(0);
    const list = spawnSync("tar", ["-tf", path.join(w.home, "pull.tar")], { encoding: "utf8" }).stdout.trim().split("\n");
    expect(list.filter((f) => f.endsWith(".db"))).toHaveLength(2);
    expect(list.filter((f) => f.startsWith("uploads-"))).toHaveLength(1);
    expect(mode(path.join(w.home, "pull.tar"))).toBe(0o600);
  }, 90_000);

  it("status reports the release and health, and warns about a stale backup", () => {
    const w = world();
    w.deploy("20260101-000000-aaa", w.release("20260101-000000-aaa"));
    w.addRows(1);
    expect(w.admin(["status"]).out).toContain("backup  : none yet");
    w.admin(["backup"]);
    const ok = w.admin(["status"]);
    expect(ok.out).toContain("release : 20260101-000000-aaa");
    expect(ok.out).toContain("HTTP 200");
    expect(ok.out).not.toContain("WARN");
    const f = path.join(w.backups, fs.readdirSync(w.backups).find((n) => n.startsWith("journal-")) as string);
    const old = new Date(Date.now() - 50 * 3600 * 1000);
    fs.utimesSync(f, old, old);
    expect(w.admin(["status"]).out).toMatch(/WARN: the newest backup is 5\d hours old/);
  }, 60_000);

  it("backup, restore and rollback say so when nothing is deployed", () => {
    const w = world();
    for (const a of [["backup"], ["rollback"], ["restore-predeploy"]]) expect(w.admin(a).out).toContain("nothing is deployed yet");
  }, 30_000);
});

d("backup.sh BACKUP_KEEP (used for the 10 pre-deploy backups; the default of 30 is covered in scripts.test.ts)", () => {
  it("keeps only the newest N, and rejects a bad value", () => {
    const w = world();
    fs.mkdirSync(w.data, { recursive: true });
    const db = new Database(w.dbFile);
    db.exec("create table t (n integer)");
    db.close();
    const out = path.join(w.dir, "keep");
    for (let i = 0; i < 4; i++) {
      const r = spawnSync("sh", [path.join(REPO, "scripts/backup.sh")], { encoding: "utf8", env: w.env({ BACKUP_DIR: out, BACKUP_KEEP: "2" }) });
      expect(r.status, r.stderr).toBe(0);
    }
    expect(fs.readdirSync(out).filter((f) => f.startsWith("journal-"))).toHaveLength(2);
    const bad = spawnSync("sh", [path.join(REPO, "scripts/backup.sh")], { encoding: "utf8", env: w.env({ BACKUP_DIR: out, BACKUP_KEEP: "x" }) });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("BACKUP_KEEP");
  }, 30_000);
});

d("server-setup.sh (as a non-root run in a temp ROOT; apt, useradd and systemctl are not exercised)", () => {
  const setup = (w: ReturnType<typeof world>, args: string[], stage?: string) => {
    const stagePath = path.join(w.home, "env.new");
    if (stage !== undefined) fs.writeFileSync(stagePath, stage, { mode: 0o600 });
    const r = spawnSync("sh", [path.join(REPO, "deploy/server-setup.sh"), ...args, ...(stage !== undefined ? ["--env-stage", stagePath] : [])], {
      cwd: w.home,
      encoding: "utf8",
      env: w.env({ PATH: `${w.initBin}:${BASE_PATH}`, UNIT_DIR: path.join(w.root, "etc/systemd/system") }),
    });
    return { code: r.status, out: r.stdout + r.stderr, stagePath };
  };

  it("creates layout, units and the env file once; re-running keeps password and SESSION_SECRET; only asked keys change", () => {
    const w = world();
    fs.rmSync(path.join(w.root, "etc/edge-journal"), { recursive: true });
    const first = setup(w, [], 'APP_PASSWORD="first-pass-123"\nSESSION_SECRET=aaaa\nHOST=127.0.0.1\nPORT=3000\nCOOKIE_SECURE=true\n');
    expect(first.code, first.out).toBe(0);
    expect(fs.existsSync(first.stagePath)).toBe(false); // the staged secrets are deleted
    expect(mode(w.envFile)).toBe(0o600);
    for (const dir of [w.data, w.backups, w.preDeploy]) expect(mode(dir)).toBe(0o700);
    expect(fs.existsSync(path.join(w.root, "opt/edge-journal/releases"))).toBe(true);
    const unit = fs.readFileSync(path.join(w.root, "etc/systemd/system/edge-journal.service"), "utf8");
    expect(unit).toContain(`ExecStart=${path.join(w.initBin, "node")} node_modules/next/dist/bin/next start`);
    expect(unit).not.toContain("@NODE@");
    for (const f of ["edge-journal-backup.service", "edge-journal-backup.timer"]) expect(fs.existsSync(path.join(w.root, "etc/systemd/system", f))).toBe(true);
    const original = fs.readFileSync(w.envFile, "utf8");

    const again = setup(w, []);
    expect(again.code, again.out).toBe(0);
    expect(again.out).toContain("untouched");
    expect(fs.readFileSync(w.envFile, "utf8")).toBe(original);

    const pw = setup(w, [], 'APP_PASSWORD="second-pass-456"\n');
    expect(pw.code).toBe(0);
    const merged = fs.readFileSync(w.envFile, "utf8");
    expect(merged).toContain('APP_PASSWORD="second-pass-456"');
    expect(merged.match(/^APP_PASSWORD=/gm)).toHaveLength(1);
    expect(merged).toContain("SESSION_SECRET=aaaa");
    expect(merged).toContain("PORT=3000");
    expect(mode(w.envFile)).toBe(0o600);

    const bad = setup(w, [], "bad-key=1\n");
    expect(bad.code).toBe(1);
    expect(fs.readFileSync(w.envFile, "utf8")).toBe(merged);
  }, 30_000);

  it("stops without changing anything when Node 22 is missing and --install-node was not given", () => {
    const w = world();
    sh(path.join(w.initBin, "node"), "#!/bin/sh\ncase \"$1\" in -p) echo 18 ;; -v) echo v18.0.0 ;; esac\n");
    fs.rmSync(path.join(w.root, "etc/edge-journal"), { recursive: true });
    const r = setup(w, [], "APP_PASSWORD=x\n");
    expect(r.code).toBe(1);
    expect(r.out).toContain("--install-node");
    expect(fs.existsSync(path.join(w.root, "opt/edge-journal"))).toBe(false);
    expect(fs.existsSync(r.stagePath)).toBe(false);
  }, 30_000);
});

/** A throwaway git checkout holding the real scripts, so the laptop dispatcher can be driven end to end. */
function laptop(w: ReturnType<typeof world>) {
  const repo = path.join(w.dir, "repo");
  fs.mkdirSync(path.join(repo, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(repo, "deploy"));
  for (const f of ["server.sh", "backup.sh", "restore.sh"]) fs.copyFileSync(path.join(REPO, "scripts", f), path.join(repo, "scripts", f));
  for (const f of fs.readdirSync(path.join(REPO, "deploy"))) fs.copyFileSync(path.join(REPO, "deploy", f), path.join(repo, "deploy", f));
  fs.writeFileSync(path.join(repo, "package.json"), "{}");
  const local = path.join(w.dir, "local-backups");
  fs.writeFileSync(path.join(repo, ".deploy.env"), `SERVER=tester@server.invalid\nSSH_PORT=2222\nPORT=${w.port}\nBIND=127.0.0.1\nLOCAL_BACKUP_DIR=${local}\n`);
  fs.writeFileSync(path.join(repo, ".gitignore"), ".deploy.env\n");
  const git = (...a: string[]) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: repo, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  const commit = (schema: number, msg: string, extra: Record<string, unknown> = {}) => {
    fs.writeFileSync(path.join(repo, "app.json"), JSON.stringify({ schema, ...extra }));
    git("add", "-A");
    expect(git("commit", "-q", "-m", msg).status).toBe(0);
  };
  const cli = (args: string[], input = "", extra: Record<string, string> = {}) => {
    const r = spawnSync("sh", [path.join(repo, "scripts/server.sh"), ...args], {
      cwd: repo,
      encoding: "utf8",
      input,
      timeout: 120_000,
      env: w.env({ PATH: `${w.bin}:${BASE_PATH}`, ...extra }),
    });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  return { repo, local, git, commit, cli };
}

d("scripts/server.sh (laptop side, ssh/scp/sudo stubs run the remote commands locally)", () => {
  const SECRET = "correct horse battery 42";

  it("prints help, and explains a missing .deploy.env", () => {
    const w = world();
    const l = laptop(w);
    expect(l.cli(["--help"]).out).toContain("Usage: ./scripts/server.sh");
    fs.rmSync(path.join(l.repo, ".deploy.env"));
    const r = l.cli(["status"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("no .deploy.env");
    expect(l.cli(["bogus"]).code).toBe(1);
  }, 30_000);

  it("init: never puts the password on a command line, creates the env file once, keeps it on re-runs", () => {
    const w = world();
    const l = laptop(w);
    fs.rmSync(path.join(w.root, "etc/edge-journal"), { recursive: true });
    const run = (args: string[], input = "") => l.cli(args, input, { PATH: `${w.initBin}:${w.bin}:${BASE_PATH}`, UNIT_DIR: path.join(w.root, "etc/systemd/system") });
    // a short and a mismatching password are refused; the third pair is accepted
    const r = run(["init"], `short\nshort\nabcdefghij\nabcdefghiX\n${SECRET}\n${SECRET}\n`);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("Too short");
    expect(r.out).toContain("differ");
    expect(r.out).not.toContain(SECRET);
    const env = fs.readFileSync(w.envFile, "utf8");
    expect(env).toContain(`APP_PASSWORD="${SECRET}"`);
    expect(env).toMatch(/^SESSION_SECRET=[0-9a-f]{64}$/m);
    expect(env).toMatch(/^HOST=127\.0\.0\.1$/m);
    expect(env).toMatch(/^COOKIE_SECURE=true$/m);
    expect(mode(w.envFile)).toBe(0o600);
    // I6: neither the password nor the secret appears in anything passed to ssh / scp
    const log = fs.readFileSync(w.stubLog, "utf8");
    expect(log).not.toContain(SECRET);
    expect(log).not.toContain(env.match(/^SESSION_SECRET=(.*)$/m)?.[1] as string);
    expect(log).toContain("-p 2222"); // the configured ssh port is used
    expect(fs.existsSync(path.join(w.home, "edge-journal-incoming/env.new"))).toBe(false);

    // I7: a re-run touches nothing and does not even ask for a password
    const before = fs.readFileSync(w.envFile, "utf8");
    const again = run(["init"]);
    expect(again.code, again.out).toBe(0);
    expect(fs.readFileSync(w.envFile, "utf8")).toBe(before);

    const secret = before.match(/^SESSION_SECRET=(.*)$/m)?.[1];
    const rotated = run(["init", "--rotate-secret"]);
    expect(rotated.code, rotated.out).toBe(0);
    const afterRotate = fs.readFileSync(w.envFile, "utf8");
    expect(afterRotate.match(/^SESSION_SECRET=(.*)$/m)?.[1]).not.toBe(secret);
    expect(afterRotate).toContain(`APP_PASSWORD="${SECRET}"`);

    const reset = run(["init", "--reset-password"], `${SECRET}-2\n${SECRET}-2\n`);
    expect(reset.code, reset.out).toBe(0);
    const afterReset = fs.readFileSync(w.envFile, "utf8");
    expect(afterReset).toContain(`APP_PASSWORD="${SECRET}-2"`);
    expect(afterReset.match(/^SESSION_SECRET=(.*)$/m)?.[1]).toBe(afterRotate.match(/^SESSION_SECRET=(.*)$/m)?.[1]);
  }, 60_000);

  it("init in all-interfaces mode sets COOKIE_SECURE=false and prints firewall advice", () => {
    const w = world();
    const l = laptop(w);
    fs.rmSync(path.join(w.root, "etc/edge-journal"), { recursive: true });
    fs.writeFileSync(path.join(l.repo, ".deploy.env"), `SERVER=tester@server.invalid\nPORT=${w.port}\n`);
    const r = l.cli(["init"], `${SECRET}\n${SECRET}\n2\n`, { PATH: `${w.initBin}:${w.bin}:${BASE_PATH}`, UNIT_DIR: path.join(w.root, "etc/systemd/system"), SSH_CLIENT: "203.0.113.7 5555 22" });
    expect(r.code, r.out).toBe(0);
    const env = fs.readFileSync(w.envFile, "utf8");
    expect(env).toMatch(/^HOST=0\.0\.0\.0$/m);
    expect(env).toMatch(/^COOKIE_SECURE=false$/m);
    expect(r.out).toContain("ufw allow from 203.0.113.7 to any port " + w.port);
  }, 60_000);

  it("deploy: refuses a dirty tree, ships the committed HEAD with a RELEASE file, and a second deploy backs up first", () => {
    const w = world();
    const l = laptop(w);
    l.commit(1, "first");
    fs.writeFileSync(path.join(l.repo, "untracked.txt"), "x");
    const dirty = l.cli(["deploy", "--skip-checks"]);
    expect(dirty.code).toBe(1);
    expect(dirty.out).toContain("uncommitted changes");
    fs.rmSync(path.join(l.repo, "untracked.txt"));

    const first = l.cli(["deploy", "--skip-checks"]);
    expect(first.code, first.out).toBe(0);
    expect(first.out).toContain("Deployed ");
    const id = w.current();
    expect(id).toMatch(/^\d{8}-\d{6}-[0-9a-f]{7}$/);
    const rel = path.join(w.root, "opt/edge-journal/releases", id);
    expect(fs.readFileSync(path.join(rel, "RELEASE"), "utf8")).toMatch(/^commit=[0-9a-f]{40}$/m);
    expect(fs.existsSync(path.join(rel, ".deploy.env"))).toBe(false); // config / secrets are never shipped
    expect(fs.existsSync(path.join(w.home, "edge-journal-incoming", `release-${id}.tar.gz`))).toBe(false); // staged tarball removed
    expect(fs.existsSync(path.join(w.home, "edge-journal-incoming", `release-${id}.RELEASE`))).toBe(false);

    w.addRows(4);
    l.commit(2, "second");
    spawnSync("sleep", ["1"]); // release ids have a one-second resolution
    fs.writeFileSync(path.join(l.repo, "wip.txt"), "x");
    const allowDirty = l.cli(["deploy", "--skip-checks", "--allow-dirty"]);
    expect(allowDirty.code, allowDirty.out).toBe(0);
    expect(allowDirty.out).toContain("NOT deployed");
    expect(fs.existsSync(path.join(w.root, "opt/edge-journal/releases", w.current(), "wip.txt"))).toBe(false);
    expect(w.preDeployDbs()).toHaveLength(1);
    expect(dbInfo(path.join(w.preDeploy, w.preDeployDbs()[0])).rows).toBe(4);
    expect(dbInfo(w.dbFile).uv).toBe(2);
  }, 120_000);

  it("deploy exits non-zero and says what happened when the new release is rolled back", () => {
    const w = world();
    const l = laptop(w);
    l.commit(1, "good");
    expect(l.cli(["deploy", "--skip-checks"]).code).toBe(0);
    const good = w.current();
    spawnSync("sleep", ["1"]);
    l.commit(1, "bad", { down: true });
    const r = l.cli(["deploy", "--skip-checks"]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("went back to the previous code");
    expect(w.current()).toBe(good);
  }, 120_000);

  it("status, health, backup, pull-backups (off-site copy, verified, 0700), restore with typed confirmation, rollback", () => {
    const w = world();
    const l = laptop(w);
    l.commit(1, "one");
    expect(l.cli(["deploy", "--skip-checks"]).code).toBe(0);
    w.addRows(5);

    const status = l.cli(["status"]);
    expect(status.code, status.out).toBe(0);
    expect(status.out).toContain("release : " + w.current());
    expect(status.out).toContain("no copy on this machine yet"); // off-site warning
    expect(status.out).toContain("backup  : none yet");
    expect(l.cli(["health"]).out).toContain('{"ok":true}');

    expect(l.cli(["backup"]).out).toContain("BACKUP journal-");
    const pull = l.cli(["pull-backups", "-n", "3"]);
    expect(pull.code, pull.out).toBe(0);
    expect(pull.out).toContain("verified: journal-");
    expect(pull.out).toContain("0 4 * * * cd ");
    expect(mode(l.local)).toBe(0o700);
    const copies = fs.readdirSync(l.local);
    const db = copies.find((f) => f.startsWith("journal-")) as string;
    expect(dbInfo(path.join(l.local, db)).rows).toBe(5);
    expect(copies.some((f) => f.startsWith("uploads-"))).toBe(true);
    expect(fs.readdirSync(path.join(w.home, "edge-journal-incoming")).some((f) => f.startsWith("pull-"))).toBe(false); // staged tarball deleted
    const after = l.cli(["status"]);
    expect(after.out).toMatch(/off-site: journal-.* \(0 days old\)/);
    expect(after.out).not.toContain("WARN");

    // restore: anything but RESTORE cancels and changes nothing
    w.addRows(20);
    const live = sha(w.dbFile);
    const cancelled = l.cli(["restore", path.join(l.local, db)], "no\n");
    expect(cancelled.code).toBe(1);
    expect(cancelled.out).toContain("cancelled");
    expect(sha(w.dbFile)).toBe(live);
    const restored = l.cli(["restore", path.join(l.local, db), path.join(l.local, copies.find((f) => f.startsWith("uploads-")) as string)], "RESTORE\n");
    expect(restored.code, restored.out).toBe(0);
    expect(dbInfo(w.dbFile).rows).toBe(5);
    expect(fs.readdirSync(w.data).some((f) => f.startsWith("journal.db.pre-restore-"))).toBe(true);
    expect(fs.existsSync(path.join(w.home, "edge-journal-incoming", fs.readdirSync(path.join(w.home, "edge-journal-incoming")).find((f) => f.startsWith("restore-")) ?? "none"))).toBe(false);

    // restoring a local database whose -wal is separate is refused (that copy would silently lack recent data)
    fs.copyFileSync(path.join(l.local, db), path.join(l.local, "x.db"));
    fs.writeFileSync(path.join(l.local, "x.db-wal"), "w");
    expect(l.cli(["restore", path.join(l.local, "x.db")], "RESTORE\n").out).toContain("-wal");

    // rollback with a newer DB: exit 5 on the server, typed confirmation on the laptop, then restored
    spawnSync("sleep", ["1"]);
    l.commit(2, "two");
    expect(l.cli(["deploy", "--skip-checks"]).code).toBe(0);
    const rb = l.cli(["rollback"], "RESTORE\n");
    expect(rb.code, rb.out).toBe(0);
    expect(rb.out).toContain("LOSES everything written since that backup");
    expect(dbInfo(w.dbFile).uv).toBe(1);
  }, 240_000);

  it("doctor runs the read-only check on the 'server' and prints a verdict", () => {
    const w = world();
    const l = laptop(w);
    const offline = path.join(w.dir, "offline"); // a curl that cannot reach anything: no real network in the test
    fs.mkdirSync(offline);
    sh(path.join(offline, "curl"), "#!/bin/sh\nexit 7\n");
    const r = l.cli(["doctor"], "", { PATH: `${offline}:${w.bin}:${BASE_PATH}` });
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("VERDICT:");
    expect(r.out).toContain("cannot reach https://registry.npmjs.org/"); // reported with the fix, not a crash
  }, 60_000);

  it("an unreachable server gives a pointer, not a stack of errors", () => {
    const w = world();
    const l = laptop(w);
    sh(path.join(w.bin, "ssh"), "#!/bin/sh\necho 'ssh: connect to host server.invalid port 2222: Connection refused' >&2\nexit 255\n");
    const r = l.cli(["status"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("Cannot run commands on tester@server.invalid");
  }, 30_000);
});
