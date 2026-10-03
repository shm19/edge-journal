import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tempDb } from "../../test/db";

vi.mock("@/lib/auth", () => ({ isAuthenticated: vi.fn(async () => true) }));

async function load() {
  await tempDb();
  const actions = await import("@/lib/actions");
  const { db, UPLOAD_DIR } = await import("@/db");
  const schema = await import("@/db/schema");
  const settings = await import("@/lib/settings");
  return { actions, db, UPLOAD_DIR, schema, settings };
}
let c: Awaited<ReturnType<typeof load>>;
beforeEach(async () => {
  c = await load();
});

const ok = <T,>(r: { ok: boolean } & T) => {
  expect(r.ok).toBe(true);
  return r;
};

describe("saveSetup / deleteSetup", () => {
  const setup = (o: Record<string, unknown> = {}) => ({ name: "My setup", description: "d", rules: "r", checklist: ["a"], status: "live", defaultTimeframe: null, color: "#112233", ...o });

  it("creates, updates, and deletes", async () => {
    const created = await c.actions.saveSetup(setup());
    expect(created.ok).toBe(true);
    const id = (created as { data: { id: number } }).data.id;
    expect(c.db.select().from(c.schema.setups).where(eq(c.schema.setups.id, id)).get()?.name).toBe("My setup");

    expect(ok(await c.actions.saveSetup({ ...setup({ name: "Renamed" }), id })).ok).toBe(true);
    const row = c.db.select().from(c.schema.setups).where(eq(c.schema.setups.id, id)).get()!;
    expect(row.name).toBe("Renamed");
    expect(row.updatedAt).toBeTruthy();

    expect(await c.actions.deleteSetup(id)).toEqual({ ok: true });
    expect(c.db.select().from(c.schema.setups).where(eq(c.schema.setups.id, id)).get()).toBeUndefined();
  });

  it("reports a deleted setup, a duplicate name and invalid input", async () => {
    expect(await c.actions.saveSetup({ ...setup(), id: 9999 })).toEqual({ ok: false, error: "This setup was deleted" });
    await c.actions.saveSetup(setup());
    expect(await c.actions.saveSetup(setup())).toEqual({ ok: false, error: "A setup with that name already exists" });
    const bad = await c.actions.saveSetup({ name: "" });
    expect(bad.ok).toBe(false);
  });

  it("reports a non-unique database failure as a generic error", async () => {
    const { sqlite } = await import("@/db");
    sqlite.exec("CREATE TRIGGER boom BEFORE INSERT ON setups BEGIN SELECT RAISE(ABORT, 'disk on fire'); END;");
    expect(await c.actions.saveSetup(setup({ name: "Z" }))).toEqual({ ok: false, error: "Failed to save setup" });
  });
});

describe("saveTag / deleteTag", () => {
  const tag = (o: Record<string, unknown> = {}) => ({ name: "Fresh", group: "Level", color: "#123456", ...o });
  const find = (name: string) => c.db.select().from(c.schema.tags).where(eq(c.schema.tags.name, name)).get();

  it("creates, updates and deletes", async () => {
    expect(await c.actions.saveTag(tag())).toEqual({ ok: true });
    const id = find("Fresh")!.id;
    expect(await c.actions.saveTag({ ...tag({ name: "Fresher" }), id })).toEqual({ ok: true });
    expect(find("Fresher")?.id).toBe(id);
    expect(await c.actions.deleteTag(id)).toEqual({ ok: true });
    expect(find("Fresher")).toBeUndefined();
  });

  it("rejects a clash (case-insensitive), a deleted tag and invalid input", async () => {
    await c.actions.saveTag(tag());
    expect(await c.actions.saveTag(tag({ name: "FRESH", group: "level" }))).toEqual({ ok: false, error: "“FRESH” already exists in Level" });
    expect(await c.actions.saveTag({ ...tag({ name: "Other" }), id: 9999 })).toEqual({ ok: false, error: "This tag was deleted" });
    expect((await c.actions.saveTag({ name: "" })).ok).toBe(false);
  });

  it("lets a tag keep its own name when edited", async () => {
    await c.actions.saveTag(tag());
    const id = find("Fresh")!.id;
    expect(await c.actions.saveTag({ ...tag({ color: "#abcdef" }), id })).toEqual({ ok: true });
    expect(find("Fresh")?.color).toBe("#abcdef");
  });
});

describe.each([
  ["scenario type", "saveScenarioType", "scenarioTypes", "An alternative type with that name already exists"],
  ["mistake type", "saveMistakeType", "mistakeTypes", "A mistake type with that name already exists"],
] as const)("%s CRUD", (_label, fn, table, dupMsg) => {
  it("creates, updates, rejects duplicates and invalid input", async () => {
    const save = c.actions[fn];
    const created = (await save({ name: "Brand new", description: "x" })) as { ok: true; data: { id: number } };
    expect(created.ok).toBe(true);
    const t = c.schema[table];
    const id = created.data.id;
    expect(await save({ id, name: "Brand newer", description: "y" })).toEqual({ ok: true, data: { id } });
    expect(c.db.select().from(t).where(eq(t.id, id)).get()?.name).toBe("Brand newer");

    expect(await save({ name: "Brand newer", description: "" })).toEqual({ ok: false, error: dupMsg });
    expect((await save({ name: "" })).ok).toBe(false);
  });
});

describe("deleteMistakeType", () => {
  it("removes the type and cascades its entries", async () => {
    const type = c.db.select().from(c.schema.mistakeTypes).limit(1).get()!;
    const idea = c.db.insert(c.schema.ideas).values({ symbol: "BTC", direction: "long", status: "taken", openedAt: "2026-09-01T10:00:00.000Z" }).returning().get();
    c.db.insert(c.schema.ideaMistakes).values({ ideaId: idea.id, mistakeTypeId: type.id }).run();
    expect(await c.actions.deleteMistakeType(type.id)).toEqual({ ok: true });
    expect(c.db.select().from(c.schema.mistakeTypes).where(eq(c.schema.mistakeTypes.id, type.id)).get()).toBeUndefined();
    expect(c.db.select().from(c.schema.ideaMistakes).all()).toHaveLength(0);
  });
});

describe("saveSettings", () => {
  const valid = { beThresholdR: 0.2, minRR: 2, defaultRiskPct: 0.5, symbols: ["btc", "BTC", "sol"] };

  it("stores numbers and de-duplicated upper-case symbols, and overwrites on a second save", async () => {
    expect(await c.actions.saveSettings(valid)).toEqual({ ok: true });
    expect(c.settings.getSettings()).toEqual({ beThresholdR: 0.2, minRR: 2, defaultRiskPct: 0.5, symbols: ["BTC", "SOL"] });
    expect(await c.actions.saveSettings({ ...valid, minRR: 3 })).toEqual({ ok: true });
    expect(c.settings.getSettings().minRR).toBe(3);
  });

  it("rejects invalid input and stores nothing", async () => {
    const before = c.settings.getSettings();
    const r = await c.actions.saveSettings({ ...valid, minRR: "lots" });
    expect(r.ok).toBe(false);
    expect(c.settings.getSettings()).toEqual(before);
  });
});

describe("getSettings fallbacks", () => {
  it("falls back to defaults for non-numeric values and an empty symbol list", async () => {
    c.db.insert(c.schema.settings).values([{ key: "minRR", value: "abc" }]).onConflictDoUpdate({ target: c.schema.settings.key, set: { value: "abc" } }).run();
    c.db.delete(c.schema.settings).where(eq(c.schema.settings.key, "symbols")).run();
    const s = c.settings.getSettings();
    expect(s.minRR).toBe(1.5);
    expect(s.symbols).toEqual(["BTC", "ETH"]);
  });
});

describe("tag group edge cases", () => {
  const mk = (name: string, group: string) => c.db.insert(c.schema.tags).values({ name, group, color: "#000000" }).run();

  it("rejects an empty or over-long new group name", async () => {
    expect(await c.actions.renameTagGroup("Level", "  ")).toEqual({ ok: false, error: "Group name must be 1–40 characters" });
    expect(await c.actions.renameTagGroup("Level", "x".repeat(41))).toEqual({ ok: false, error: "Group name must be 1–40 characters" });
  });

  it("merges into an existing group using that group's spelling, and renames to a fresh name", async () => {
    mk("Solo", "Alpha");
    mk("Other", "Beta");
    expect(await c.actions.renameTagGroup("Alpha", "beta")).toEqual({ ok: true });
    const groups = c.db.select().from(c.schema.tags).where(eq(c.schema.tags.name, "Solo")).get()!.group;
    expect(groups).toBe("Beta");
    expect(await c.actions.renameTagGroup("Beta", "Gamma")).toEqual({ ok: true });
    expect(c.db.select().from(c.schema.tags).where(eq(c.schema.tags.group, "Gamma")).all().map((t) => t.name).sort()).toEqual(["Other", "Solo"]);
  });

  it("deleteTagGroup removes the group's tags and their links", async () => {
    mk("Tmp", "Doomed");
    const tag = c.db.select().from(c.schema.tags).where(eq(c.schema.tags.group, "Doomed")).get()!;
    const idea = c.db.insert(c.schema.ideas).values({ symbol: "BTC", direction: "long", status: "taken", openedAt: "2026-09-01T10:00:00.000Z" }).returning().get();
    c.db.insert(c.schema.ideaTags).values({ ideaId: idea.id, tagId: tag.id }).run();
    expect(await c.actions.deleteTagGroup("Doomed")).toEqual({ ok: true });
    expect(c.db.select().from(c.schema.tags).where(eq(c.schema.tags.group, "Doomed")).all()).toHaveLength(0);
    expect(c.db.select().from(c.schema.ideaTags).all()).toHaveLength(0);
  });
});

describe("deleteIdea and uploaded files", () => {
  it("unlinks the idea's uploaded files from disk", async () => {
    fs.mkdirSync(c.UPLOAD_DIR, { recursive: true });
    const file = path.join(c.UPLOAD_DIR, "shot-9.png");
    fs.writeFileSync(file, "x");
    const idea = c.db.insert(c.schema.ideas).values({ symbol: "BTC", direction: "long", status: "taken", openedAt: "2026-09-01T10:00:00.000Z" }).returning().get();
    c.db.insert(c.schema.attachments).values({ ideaId: idea.id, filePath: "shot-9.png", caption: "", kind: "before" }).run();
    expect(await c.actions.deleteIdea(idea.id)).toEqual({ ok: true });
    await vi.waitFor(() => expect(fs.existsSync(file)).toBe(false));
    expect(c.db.select().from(c.schema.attachments).all()).toHaveLength(0);
  });

  it("saveIdea removes the file of an attachment dropped in the editor, and keeps a kept one (updating its caption)", async () => {
    fs.mkdirSync(c.UPLOAD_DIR, { recursive: true });
    for (const n of ["a-1.png", "b-2.png"]) fs.writeFileSync(path.join(c.UPLOAD_DIR, n), "x");
    const base = {
      symbol: "btc", direction: "long", status: "taken", setupId: null, entryTimeframe: null, htfBias: null, regime: null,
      openedAt: "2026-09-01T10:00:00.000Z", closedAt: null, followedPlan: null, riskPct: null, feesUsd: null, pnlUsd: null, confidence: null,
      scenarios: [{ scenarioTypeId: null, isPrimary: true, entry: 100, stop: 90, target: null, exitPrice: null, exitReason: null, notes: "" }],
    };
    const r = (await c.actions.saveIdea({ ...base, attachments: [{ filePath: "a-1.png", caption: "", kind: "before" }, { filePath: "b-2.png", caption: "", kind: "after" }] })) as { data: { id: number } };
    const atts = c.db.select().from(c.schema.attachments).all();
    const keep = atts.find((a) => a.filePath === "a-1.png")!;
    expect((await c.actions.saveIdea({ ...base, id: r.data.id, attachments: [{ id: keep.id, filePath: "a-1.png", caption: "new", kind: "before" }] })).ok).toBe(true);
    await vi.waitFor(() => expect(fs.existsSync(path.join(c.UPLOAD_DIR, "b-2.png"))).toBe(false));
    expect(fs.existsSync(path.join(c.UPLOAD_DIR, "a-1.png"))).toBe(true);
    expect(c.db.select().from(c.schema.attachments).all().map((a) => a.caption)).toEqual(["new"]);
  });
});
