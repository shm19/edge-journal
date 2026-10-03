import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
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
  it("rejects a body that is not valid multipart", async () => {
    const req = new Request("http://localhost/api/uploads", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=x" }, body: "garbage" });
    expect(await (await c.uploads.POST(req)).json()).toEqual({ error: "Couldn't read the upload" });
  });
  it("caps a chunked upload (no Content-Length) while streaming, without buffering it all", async () => {
    let pulled = 0;
    const chunk = new Uint8Array(1024 * 1024);
    const body = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        pulled++;
        if (pulled > 200) ctrl.close(); // would be 200 MB if never cut off
        else ctrl.enqueue(chunk);
      },
    });
    const req = new Request("http://localhost/api/uploads", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x" },
      body,
      duplex: "half",
    } as RequestInit);
    expect(req.headers.get("content-length")).toBeNull();
    const res = await c.uploads.POST(req);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "Image is larger than 10 MB" });
    expect(pulled).toBeLessThan(40); // stopped near 10 MB, far from 200
    expect(fs.existsSync(c.UPLOAD_DIR) ? fs.readdirSync(c.UPLOAD_DIR) : []).toEqual([]);
  });
  it("accepts a chunked upload under the cap", async () => {
    const form = new FormData();
    form.set("file", new File([PNG], "a.png"));
    const encoded = new Response(form); // one encoding: the boundary in the header must match the body
    const type = encoded.headers.get("content-type")!;
    const bytes = new Uint8Array(await encoded.arrayBuffer());
    const body = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(bytes.subarray(0, 40));
        ctrl.enqueue(bytes.subarray(40));
        ctrl.close();
      },
    });
    const req = new Request("http://localhost/api/uploads", { method: "POST", headers: { "content-type": type }, body, duplex: "half" } as RequestInit);
    expect((await c.uploads.POST(req)).status).toBe(200);
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
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(res.headers.get("content-disposition")).toBe("inline");
    // names are random, so a year-long immutable cache is fine, but never a shared cache
    expect(res.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
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
  it("never lets the journal be cached or sniffed, in any format", async () => {
    for (const f of [undefined, "csv", "db"]) {
      const res = await get(f);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    }
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
  it("exports checklist, tags, mistakes and alternatives into the CSV", async () => {
    const setup = c.db.select().from(c.schema.setups).limit(1).get()!;
    c.db.update(c.schema.setups).set({ checklist: ["Level tested", "HTF bias"] }).where(eq(c.schema.setups.id, setup.id)).run();
    const tag = c.db.select().from(c.schema.tags).limit(1).get()!;
    const mtype = c.db.select().from(c.schema.mistakeTypes).limit(1).get()!;
    const stype = c.db.select().from(c.schema.scenarioTypes).limit(1).get()!;
    const sc = (o: object) => ({ scenarioTypeId: null, isPrimary: false, entry: 100, stop: 90, target: null, exitPrice: null, exitReason: null, notes: "", ...o });
    const r = await c.actions.saveIdea({
      symbol: "eth", direction: "long", status: "taken", setupId: setup.id, entryTimeframe: "1h", htfBias: "with", regime: null,
      openedAt: "2026-09-01T10:00:00.000Z", closedAt: "2026-09-01T12:00:00.000Z", followedPlan: true, riskPct: 1, feesUsd: 1, pnlUsd: 2, confidence: 3,
      checklistState: { "Level tested": true },
      tagIds: [tag.id],
      mistakes: [{ mistakeTypeId: mtype.id, note: "oops", costR: 0.5, scenarioIndex: null }, { mistakeTypeId: mtype.id, note: "", costR: null, scenarioIndex: null }],
      scenarios: [
        sc({ isPrimary: true, target: 130, exitPrice: 120, exitReason: "target" }),
        sc({ scenarioTypeId: stype.id, exitPrice: 130, exitReason: "target" }),
        sc({ exitReason: "not_filled" }),
        sc({ target: 140 }),
      ],
    });
    expect(r.ok).toBe(true);
    const row = (await (await get("csv")).text()).split("\n")[1];
    expect(row).toContain("[x] Level tested; [ ] HTF bias");
    expect(row).toContain(`${tag.group}:${tag.name}`);
    expect(row).toContain(`${mtype.name} (0.50R): oops; ${mtype.name}`);
    expect(row).toContain(`${stype.name}: 100/90/- → 3.00R; Alt: 100/90/- → not filled; Alt: 100/90/140 → open`);
  });
  it("falls back to JSON for an unknown format", async () => {
    expect((await get("xml")).headers.get("content-type")).toBe("application/json");
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
