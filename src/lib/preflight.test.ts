import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isWritableDir, preflightProblems } from "./preflight";

const isRoot = process.getuid?.() === 0;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ej-pre-"));
const GOOD = { SESSION_SECRET: "x".repeat(32), APP_PASSWORD: "a real password" };

describe("isWritableDir", () => {
  it("creates a missing dir and reports it writable", () => {
    const dir = path.join(tmp(), "a", "b");
    expect(isWritableDir(dir)).toBe(true);
    expect(fs.existsSync(dir)).toBe(true);
  });
  it("is false when the path is a file", () => {
    const f = path.join(tmp(), "f");
    fs.writeFileSync(f, "");
    expect(isWritableDir(path.join(f, "x"))).toBe(false);
  });
  it.skipIf(isRoot)("is false for a read-only dir", () => {
    const dir = tmp();
    fs.chmodSync(dir, 0o555);
    try {
      expect(isWritableDir(dir)).toBe(false);
    } finally {
      fs.chmodSync(dir, 0o755);
    }
  });
});

afterEach(() => vi.unstubAllEnvs());
// APP_PASSWORD is judged by session.ts passwordConfigured(), which reads process.env
const problemsFor = (env: Record<string, string | undefined>, dir: string) => {
  if (env.APP_PASSWORD === undefined) vi.stubEnv("APP_PASSWORD", "");
  else vi.stubEnv("APP_PASSWORD", env.APP_PASSWORD);
  return preflightProblems(env, dir);
};

describe("preflightProblems", () => {
  it("is empty for a sane setup", () => {
    expect(problemsFor(GOOD, tmp())).toEqual([]);
  });
  it("flags an unwritable data dir with a fix hint", () => {
    const f = path.join(tmp(), "f");
    fs.writeFileSync(f, "");
    const [p, ...rest] = problemsFor(GOOD, f);
    expect(rest).toEqual([]);
    expect(p).toContain("not writable");
    expect(p).toContain("chown");
  });
  it.each([[undefined], [""], ["short"], ["x".repeat(31)]])("flags SESSION_SECRET %j", (secret) => {
    const problems = problemsFor({ ...GOOD, SESSION_SECRET: secret }, tmp());
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("SESSION_SECRET");
  });
  it.each([[undefined], [""], ["change-me"], ["Change-Me"], ["  CHANGE-ME "], ["   "]])("flags APP_PASSWORD %j", (pw) => {
    const problems = problemsFor({ ...GOOD, APP_PASSWORD: pw }, tmp());
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("APP_PASSWORD");
  });
  it("reports every problem at once and never echoes secret values", () => {
    const problems = problemsFor({ SESSION_SECRET: "tiny", APP_PASSWORD: "change-me" }, tmp());
    expect(problems).toHaveLength(2);
    expect(problems.join("\n")).not.toContain("tiny");
  });
});
