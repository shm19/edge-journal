import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tempDb } from "../../../test/db";

const auth = vi.hoisted(() => ({ ok: true }));
vi.mock("@/lib/auth", () => ({ isAuthenticated: vi.fn(async () => auth.ok) }));

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

async function load() {
  const dir = await tempDb();
  const uploads = await import("./uploads/route");
  const file = await import("./uploads/[name]/route");
  const exp = await import("./export/route");
  const health = await import("./health/route");
  const { db, UPLOAD_DIR } = await import("@/db");
  const schema = await import("@/db/schema");
  const actions = await import("@/lib/actions");
  return { dir, uploads, file, exp, health, db, UPLOAD_DIR, schema, actions };
}
let c: Awaited<ReturnType<typeof load>>;
beforeEach(async () => {
  auth.ok = true;
  c = await load();
});

const upload = (body: Blob | string, name = "x.png") => {
  const form = new FormData();
  form.set("file", typeof body === "string" ? body : new File([body], name));
  return new Request("http://localhost/api/uploads", { method: "POST", body: form });
};

describe("health", () => {
  it("is ok", async () => {
    expect(await c.health.GET().json()).toEqual({ ok: true });
  });
});

describe("POST /api/uploads", () => {
  it("rejects unauthenticated requests", async () => {
    auth.ok = false;
    expect((await c.uploads.POST(upload(new Blob([PNG])))).status).toBe(401);
  });
  it("stores a real image under a generated name with a sniffed extension", async () => {
    const res = await c.uploads.POST(upload(new Blob([PNG]), "evil.php"));
    expect(res.status).toBe(200);
    const { fileName } = await res.json();
    expect(fileName).toMatch(/^[a-z0-9]+-[0-9a-f]{12}\.png$/);
    expect(fs.readFileSync(path.join(c.UPLOAD_DIR, fileName)).equals(PNG)).toBe(true);
  });
  it("rejects non-images, missing files, and oversized files", async () => {
    expect((await c.uploads.POST(upload(new Blob(["<svg/>"]), "a.png"))).status).toBe(415);
    expect((await c.uploads.POST(upload("just text"))).status).toBe(400);
    const big = new Request("http://localhost/api/uploads", { method: "POST", headers: { "content-length": String(11 * 1024 * 1024) }, body: new FormData() });
    expect((await c.uploads.POST(big)).status).toBe(413);
    expect((await c.uploads.POST(upload(new Blob([Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)])])))).status).toBe(413);
  });
});

describe("GET /api/uploads/[name]", () => {
  const get = (name: string) => c.file.GET(new Request("http://localhost/x"), { params: Promise.resolve({ name }) });
  it("serves a stored file with hardening headers", async () => {
    fs.mkdirSync(c.UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(c.UPLOAD_DIR, "abc-123.png"), PNG);
    const res = await get("abc-123.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'");
  });
  it("404s on missing files and on traversal-looking names", async () => {
    expect((await get("nope.png")).status).toBe(404);
    expect((await get("..%2Fjournal.db")).status).toBe(404);
    expect((await get("../journal.db")).status).toBe(404);
    expect((await get("a.svg")).status).toBe(404);
  });
  it("requires auth", async () => {
    auth.ok = false;
    expect((await get("abc.png")).status).toBe(401);
  });
});

describe("GET /api/export", () => {
  const get = (format?: string) => c.exp.GET(new Request(`http://localhost/api/export${format ? `?format=${format}` : ""}`));

  async function addIdea() {
    const r = await c.actions.saveIdea({
      symbol: "btc",
      direction: "long",
      status: "taken",
      setupId: null,
      entryTimeframe: null,
      htfBias: null,
      regime: null,
      openedAt: "2026-09-01T10:00:00.000Z",
      closedAt: "2026-09-01T12:00:00.000Z",
      followedPlan: null,
      riskPct: null,
      feesUsd: null,
      pnlUsd: null,
      confidence: null,
      thesis: "=HYPERLINK(\"x\")",
      scenarios: [{ scenarioTypeId: null, isPrimary: true, entry: 100, stop: 90, target: 130, exitPrice: 120, exitReason: "target", notes: "" }],
    });
    expect(r.ok).toBe(true);
  }

  it("requires auth for every format", async () => {
    auth.ok = false;
    for (const f of [undefined, "csv", "db"]) expect((await get(f)).status).toBe(401);
  });
  it("exports JSON by default", async () => {
    await addIdea();
    const res = await get();
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("content-disposition")).toMatch(/edge-journal-\d{4}-\d{2}-\d{2}\.json/);
    const dump = await res.json();
    expect(dump.ideas).toHaveLength(1);
    expect(dump.scenarios).toHaveLength(1);
    expect(dump.setups.length).toBeGreaterThan(0);
  });
  it("exports CSV with escaped cells and one row per idea", async () => {
    await addIdea();
    const text = await (await get("csv")).text();
    const [header, row, ...rest] = text.split("\n");
    expect(rest).toHaveLength(0);
    expect(header.startsWith("id,status,opened_at")).toBe(true);
    expect(row.startsWith("1,taken,2026-09-01T10:00:00.000Z")).toBe(true);
    expect(row).toContain("BTC,long");
    expect(row).toContain(`"'=HYPERLINK(""x"")"`);
  });
  it("exports a consistent SQLite backup and cleans its staging dir", async () => {
    await addIdea();
    const oldTmp = process.env.TMPDIR;
    const scoped = fs.mkdtempSync(path.join(os.tmpdir(), "ej-tmp-"));
    process.env.TMPDIR = scoped; // os.tmpdir() reads it per call, so only this export's staging dir lands here
    try {
      const res = await get("db");
      expect(res.headers.get("content-type")).toBe("application/vnd.sqlite3");
      const buf = Buffer.from(await res.arrayBuffer());
      expect(buf.subarray(0, 15).toString()).toBe("SQLite format 3");
      expect(fs.readdirSync(scoped)).toEqual([]);
    } finally {
      if (oldTmp === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = oldTmp;
      fs.rmSync(scoped, { recursive: true, force: true });
    }
  });
});
