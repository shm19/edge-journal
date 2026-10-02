import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tempDb } from "../../test/db";

const auth = vi.hoisted(() => ({ ok: true }));
vi.mock("@/lib/auth", () => ({ isAuthenticated: vi.fn(async () => auth.ok) }));

const idea = (o: Record<string, unknown> = {}) => ({
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
  scenarios: [{ scenarioTypeId: null, isPrimary: true, entry: 100, stop: 90, target: 130, exitPrice: 120, exitReason: "target", notes: "" }],
  ...o,
});

async function load() {
  await tempDb();
  const actions = await import("@/lib/actions");
  const { db, UPLOAD_DIR } = await import("@/db");
  const schema = await import("@/db/schema");
  return { actions, db, UPLOAD_DIR, schema };
}
let c: Awaited<ReturnType<typeof load>>;
beforeEach(async () => {
  auth.ok = true;
  c = await load();
});

describe("expired session", () => {
  it("every action returns an error result instead of redirecting", async () => {
    auth.ok = false;
    const a = c.actions;
    const results = await Promise.all([
      a.saveIdea(idea()),
      a.deleteIdea(1),
      a.saveSetup({}),
      a.deleteSetup(1),
      a.saveTag({}),
      a.deleteTag(1),
      a.saveScenarioType({}),
      a.deleteScenarioType(1),
      a.saveMistakeType({}),
      a.deleteMistakeType(1),
      a.saveSettings({}),
      a.renameTagGroup("a", "b"),
      a.deleteTagGroup("a"),
    ]);
    for (const r of results) expect(r).toEqual({ ok: false, error: expect.stringMatching(/Session expired/) });
    expect(c.db.select().from(c.schema.ideas).all()).toHaveLength(0);
  });
});

describe("validation through saveIdea", () => {
  it("reports the wrong-side target with its label", async () => {
    const r = await c.actions.saveIdea(idea({ scenarios: [{ ...idea().scenarios[0], target: 95, exitPrice: null, exitReason: null }] }));
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/^Primary · Target:/) });
  });
});

describe("new attachments (P2-7)", () => {
  const att = (filePath: string) => ({ filePath, caption: "", kind: "before" });

  it("accepts an uploaded file, rejects a missing one and one used by another idea", async () => {
    fs.mkdirSync(c.UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(c.UPLOAD_DIR, "shot-1.png"), "x");
    const ok = await c.actions.saveIdea(idea({ attachments: [att("shot-1.png")] }));
    expect(ok.ok).toBe(true);

    const missing = await c.actions.saveIdea(idea({ attachments: [att("ghost.png")] }));
    expect(missing).toEqual({ ok: false, error: expect.stringMatching(/missing/) });

    const shared = await c.actions.saveIdea(idea({ attachments: [att("shot-1.png")] }));
    expect(shared).toEqual({ ok: false, error: expect.stringMatching(/another idea/) });
    // the failed saves rolled back completely and the file is still on disk
    expect(c.db.select().from(c.schema.ideas).all()).toHaveLength(1);
    expect(fs.existsSync(path.join(c.UPLOAD_DIR, "shot-1.png"))).toBe(true);
  });
});
