import { afterEach, describe, expect, it, vi } from "vitest";
import { tempDb } from "../test/db";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function boot(env: Record<string, string>) {
  await tempDb();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const { register } = await import("./instrumentation");
  await register();
  return log;
}
const PROD = { NEXT_RUNTIME: "nodejs", NODE_ENV: "production" };

describe("instrumentation register()", () => {
  it("never fails the boot, even if the preflight itself blows up", async () => {
    vi.doMock("@/lib/preflight", () => ({
      preflightProblems: () => {
        throw new Error("boom");
      },
    }));
    try {
      const log = await boot({ ...PROD });
      expect(String(log.mock.calls[0][0])).toContain("preflight could not run");
    } finally {
      vi.doUnmock("@/lib/preflight");
    }
  });
  it("logs FATAL lines in production for a bad config but does not throw", async () => {
    const log = await boot({ ...PROD, SESSION_SECRET: "", APP_PASSWORD: "change-me" });
    const lines = log.mock.calls.map((c) => String(c[0]));
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.startsWith("FATAL: "))).toBe(true);
  });
  it("is silent in production for a good config", async () => {
    const log = await boot({ ...PROD, SESSION_SECRET: "x".repeat(32), APP_PASSWORD: "hunter2hunter2" });
    expect(log).not.toHaveBeenCalled();
  });
  it("does nothing outside production or off the Node runtime", async () => {
    expect(await boot({ NEXT_RUNTIME: "nodejs", NODE_ENV: "development", SESSION_SECRET: "" })).not.toHaveBeenCalled();
    expect(await boot({ NEXT_RUNTIME: "edge", NODE_ENV: "production", SESSION_SECRET: "" })).not.toHaveBeenCalled();
  });
});
