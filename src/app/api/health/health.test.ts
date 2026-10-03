import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tempDb } from "../../../../test/db";

const isRoot = process.getuid?.() === 0; // root ignores file modes, so the unwritable cases can't be built

async function load() {
  const dir = await tempDb();
  const health = await import("./route");
  return { dir, health };
}
afterEach(() => vi.restoreAllMocks());

describe("GET /api/health", () => {
  it("is 200 {ok:true} when the DB answers and the data and upload dirs are writable", async () => {
    const { health } = await load();
    const res = health.GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it.skipIf(isRoot)("is 503 with a generic body when the uploads dir is not writable", async () => {
    const { dir, health } = await load();
    health.GET(); // open the DB first so only the dir check can fail
    const uploads = path.join(dir, "uploads");
    fs.chmodSync(uploads, 0o555);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = health.GET();
      expect(res.status).toBe(503);
      const body = await res.text();
      expect(JSON.parse(body)).toEqual({ ok: false });
      expect(body).not.toContain(dir);
      expect(log).toHaveBeenCalledOnce();
    } finally {
      fs.chmodSync(uploads, 0o755);
    }
  });

  it("is 503 when the database cannot be read", async () => {
    const { health } = await load();
    health.GET();
    const { sqlite } = await import("@/db");
    sqlite.close();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = health.GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false });
  });
});
