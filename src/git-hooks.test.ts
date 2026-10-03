// The git hooks in .githooks/ are plain shell. Run them for real in a throwaway git repo with stub `npm` / `npx`
// binaries, so the test proves the gating behaviour without running the actual suites.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const HOOKS = path.resolve(__dirname, "../.githooks");
const dirs: string[] = [];

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ej-hooks-"));
  dirs.push(dir);
  const bin = path.join(dir, "bin");
  const repo = path.join(dir, "repo");
  const log = path.join(dir, "stub.log");
  fs.mkdirSync(bin);
  fs.mkdirSync(repo);
  for (const name of ["npm", "npx"]) {
    const stub = path.join(bin, name);
    fs.writeFileSync(
      stub,
      `#!/bin/sh\necho "${name} $*" >> "$STUB_LOG"\necho "stub output from ${name} $*"\n[ -n "\${FAIL_ON:-}" ] && case "$*" in *"$FAIL_ON"*) exit 1;; esac\nexit 0\n`,
    );
    fs.chmodSync(stub, 0o755);
  }
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, STUB_LOG: log, FAIL_ON: "" } as NodeJS.ProcessEnv;
  const git = (...args: string[]) => spawnSync("git", args, { cwd: repo, env, encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  fs.cpSync(HOOKS, path.join(repo, ".githooks"), { recursive: true });
  fs.mkdirSync(path.join(repo, "node_modules"));
  git("config", "core.hooksPath", ".githooks");
  const commit = (file: string, failOn = "", extra: string[] = []) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), `x ${Math.random()}\n`);
    git("add", file);
    env.FAIL_ON = failOn;
    return git("commit", "-q", "-m", "test", ...extra);
  };
  const commits = () => (git("rev-list", "--count", "HEAD").stdout.trim() || "0");
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : []);
  const runHook = (name: string, failOn = "") => {
    env.FAIL_ON = failOn;
    return spawnSync("sh", [path.join(repo, ".githooks", name)], { cwd: repo, env, encoding: "utf8" });
  };
  return { commit, commits, calls, runHook };
}

afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

describe("pre-commit", () => {
  it("runs lint, typecheck and the fast unit tests, then lets a good commit through", () => {
    const s = sandbox();
    const r = s.commit("src/a.ts");
    expect(r.status).toBe(0);
    expect(s.commits()).toBe("1");
    const calls = s.calls();
    expect(calls).toContain("npm run lint --silent");
    expect(calls).toContain("npm run typecheck --silent");
    const vitest = calls.find((c) => c.startsWith("npx vitest run"));
    expect(vitest).toContain("--exclude src/deploy-scripts.test.ts");
    expect(vitest).toContain("--exclude src/scripts.test.ts");
  });

  it("blocks the commit when a check fails and says which one", () => {
    const s = sandbox();
    const r = s.commit("src/a.ts", "typecheck");
    expect(r.status).not.toBe(0);
    expect(s.commits()).toBe("0");
    expect(r.stdout + r.stderr).toMatch(/FAIL\s+typecheck/);
    expect(r.stdout + r.stderr).toContain("stub output from npm run typecheck"); // the tail of the failing output is shown
    expect(r.stdout + r.stderr).toContain("--no-verify");
    expect(s.calls().some((c) => c.startsWith("npx vitest"))).toBe(false); // stops at the first failure
  });

  it("blocks on a failing unit test run", () => {
    const s = sandbox();
    const r = s.commit("src/a.ts", "vitest");
    expect(r.status).not.toBe(0);
    expect(s.commits()).toBe("0");
    expect(r.stdout + r.stderr).toMatch(/FAIL\s+unit tests/);
  });

  it("skips the checks for a docs-only commit", () => {
    const s = sandbox();
    const r = s.commit("docs/notes.md", "lint");
    expect(r.status).toBe(0);
    expect(s.commits()).toBe("1");
    expect(s.calls()).toEqual([]);
    expect(r.stdout + r.stderr).toContain("docs only");
  });

  it("can be bypassed once with --no-verify", () => {
    const s = sandbox();
    const r = s.commit("src/a.ts", "lint", ["--no-verify"]);
    expect(r.status).toBe(0);
    expect(s.commits()).toBe("1");
    expect(s.calls()).toEqual([]);
  });
});

describe("pre-push", () => {
  it("runs the full check and e2e", () => {
    const s = sandbox();
    const r = s.runHook("pre-push");
    expect(r.status).toBe(0);
    expect(s.calls()).toEqual(["npm run check --silent", "npm run e2e --silent"]);
  });

  it("fails when e2e fails, and does not run e2e when the check fails", () => {
    const s = sandbox();
    const e2e = s.runHook("pre-push", "e2e");
    expect(e2e.status).not.toBe(0);
    expect(e2e.stdout + e2e.stderr).toMatch(/FAIL\s+e2e/);
    const s2 = sandbox();
    const check = s2.runHook("pre-push", "check");
    expect(check.status).not.toBe(0);
    expect(s2.calls()).toEqual(["npm run check --silent"]);
  });
});
