import { beforeEach, describe, expect, it, vi } from "vitest";
import { tempDb } from "../../test/db";

vi.mock("@/lib/auth", () => ({ isAuthenticated: vi.fn(async () => true) }));

type Scen = {
  id?: number;
  scenarioTypeId: number | null;
  isPrimary: boolean;
  entry: number;
  stop: number;
  target: number | null;
  exitPrice: number | null;
  exitReason: "target" | "stop" | "manual" | null;
  notes: string;
};

const scen = (o: Partial<Scen> = {}): Scen => ({
  scenarioTypeId: null,
  isPrimary: true,
  entry: 100,
  stop: 90,
  target: 130,
  exitPrice: 120,
  exitReason: "target",
  notes: "",
  ...o,
});

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
  scenarios: [scen()],
  ...o,
});

async function load() {
  await tempDb();
  const actions = await import("@/lib/actions");
  const { db } = await import("@/db");
  const schema = await import("@/db/schema");
  const queries = await import("@/lib/queries");
  return { actions, db, schema, queries };
}

let ctx: Awaited<ReturnType<typeof load>>;
beforeEach(async () => {
  ctx = await load();
});

const saved = async (payload: unknown) => {
  const res = await ctx.actions.saveIdea(payload);
  if (!res.ok) throw new Error(res.error);
  return res.data!.id;
};

describe("saveIdea: create & update", () => {
  it("creates an idea with its primary, uppercases the symbol", async () => {
    const id = await saved(idea());
    const v = ctx.queries.getIdea(id)!;
    expect(v.symbol).toBe("BTC");
    expect(v.primary?.r).toBe(2);
    expect(v.scenarios).toHaveLength(1);
  });

  it("updates in place and keeps scenario ids", async () => {
    const id = await saved(idea());
    const before = ctx.queries.getIdea(id)!.scenarios[0];
    await saved(idea({ id, scenarios: [scen({ id: before.id, exitPrice: 110 })] }));
    const after = ctx.queries.getIdea(id)!;
    expect(after.scenarios).toHaveLength(1);
    expect(after.scenarios[0].id).toBe(before.id);
    expect(after.primary?.r).toBe(1);
  });

  it("removes scenarios dropped in the editor", async () => {
    const id = await saved(idea({ scenarios: [scen(), scen({ isPrimary: false, exitPrice: 90, exitReason: "stop" })] }));
    const [p] = ctx.queries.getIdea(id)!.scenarios;
    await saved(idea({ id, scenarios: [scen({ id: p.id })] }));
    expect(ctx.queries.getIdea(id)!.scenarios).toHaveLength(1);
  });

  it("rejects an unknown idea id", async () => {
    const res = await ctx.actions.saveIdea(idea({ id: 999 }));
    expect(res).toEqual({ ok: false, error: "Idea not found" });
  });

  it("returns a validation error instead of throwing", async () => {
    const res = await ctx.actions.saveIdea(idea({ scenarios: [] }));
    expect(res.ok).toBe(false);
  });
});

describe("saveIdea: stale or foreign scenario ids (P0-1)", () => {
  async function mistakeType() {
    return ctx.db.insert(ctx.schema.mistakeTypes).values({ name: "Test mistake A" }).returning().get().id;
  }

  it("a scenario deleted in another tab is re-created, not lost, and a linked mistake survives", async () => {
    const mt = await mistakeType();
    const id = await saved(idea({ scenarios: [scen(), scen({ isPrimary: false, exitPrice: 130 })] }));
    const [p, alt] = ctx.queries.getIdea(id)!.scenarios;
    ctx.db.delete(ctx.schema.scenarios).where((await import("drizzle-orm")).eq(ctx.schema.scenarios.id, alt.id)).run();

    const res = await ctx.actions.saveIdea(
      idea({
        id,
        scenarios: [scen({ id: p.id }), scen({ id: alt.id, isPrimary: false, exitPrice: 130 })],
        mistakes: [{ mistakeTypeId: mt, note: "", costR: null, scenarioIndex: 1 }],
      }),
    );
    expect(res.ok).toBe(true);
    const v = ctx.queries.getIdea(id)!;
    expect(v.scenarios).toHaveLength(2);
    const revived = v.scenarios.find((s) => !s.isPrimary)!;
    expect(revived.id).not.toBe(alt.id);
    expect(v.mistakes[0].scenarioId).toBe(revived.id);
    expect(v.mistakes[0].cost).toBe(1); // 3R alternative vs 2R primary
  });

  it("a scenario id of another idea never links a mistake to that idea's scenario", async () => {
    const mt = await mistakeType();
    const other = await saved(idea({ scenarios: [scen(), scen({ isPrimary: false, exitPrice: 130 })] }));
    const otherAlt = ctx.queries.getIdea(other)!.scenarios.find((s) => !s.isPrimary)!;

    const id = await saved(
      idea({
        scenarios: [scen(), scen({ id: otherAlt.id, isPrimary: false, exitPrice: 95, exitReason: "manual" })],
        mistakes: [{ mistakeTypeId: mt, note: "", costR: null, scenarioIndex: 1 }],
      }),
    );
    const v = ctx.queries.getIdea(id)!;
    const mine = v.scenarios.find((s) => !s.isPrimary)!;
    expect(mine.id).not.toBe(otherAlt.id);
    expect(v.mistakes[0].scenarioId).toBe(mine.id);
    // the other idea is untouched
    const o = ctx.queries.getIdea(other)!;
    expect(o.scenarios.find((s) => !s.isPrimary)!.exitPrice).toBe(130);
    expect(o.scenarios).toHaveLength(2);
  });
});

describe("saveIdea: tags, mistakes, cleanup", () => {
  it("replaces tag links and ignores unknown tag ids", async () => {
    const t1 = ctx.db.insert(ctx.schema.tags).values({ name: "a", group: "G" }).returning().get().id;
    const t2 = ctx.db.insert(ctx.schema.tags).values({ name: "b", group: "G" }).returning().get().id;
    const id = await saved(idea({ tagIds: [t1, t2, t2, 9999] }));
    expect(ctx.queries.getIdea(id)!.tags.map((t) => t.name)).toEqual(["a", "b"]);
    await saved(idea({ id, tagIds: [t2] }));
    expect(ctx.queries.getIdea(id)!.tags.map((t) => t.name)).toEqual(["b"]);
    await saved(idea({ id, tagIds: [] }));
    expect(ctx.queries.getIdea(id)!.tags).toHaveLength(0);
  });

  it("stores manual and linked mistakes, drops mistakes of deleted types", async () => {
    const mt = ctx.db.insert(ctx.schema.mistakeTypes).values({ name: "Test mistake B" }).returning().get().id;
    const id = await saved(
      idea({
        scenarios: [scen(), scen({ isPrimary: false, exitPrice: 90, exitReason: "stop" })],
        mistakes: [
          { mistakeTypeId: mt, note: "manual", costR: 0.5, scenarioIndex: null },
          { mistakeTypeId: mt, note: "linked", costR: null, scenarioIndex: 1 },
          { mistakeTypeId: 4242, note: "gone", costR: null, scenarioIndex: null },
        ],
      }),
    );
    const m = ctx.queries.getIdea(id)!.mistakes;
    expect(m).toHaveLength(2);
    expect(m[0].cost).toBe(0.5);
    expect(m[1].cost).toBe(-3); // -1R alternative vs +2R primary
  });

  it("falls back to no setup / no type when they were deleted", async () => {
    const id = await saved(idea({ setupId: 777, scenarios: [scen({ scenarioTypeId: 888 })] }));
    const v = ctx.queries.getIdea(id)!;
    expect(v.setupId).toBeNull();
    expect(v.scenarios[0].scenarioTypeId).toBeNull();
  });
});

describe("deleteIdea", () => {
  it("cascades scenarios, tags and mistakes", async () => {
    const mt = ctx.db.insert(ctx.schema.mistakeTypes).values({ name: "Test mistake B" }).returning().get().id;
    const t = ctx.db.insert(ctx.schema.tags).values({ name: "a", group: "G" }).returning().get().id;
    const id = await saved(idea({ tagIds: [t], mistakes: [{ mistakeTypeId: mt, note: "", costR: 1, scenarioIndex: null }] }));
    expect(await ctx.actions.deleteIdea(id)).toEqual({ ok: true });
    expect(ctx.queries.getIdea(id)).toBeUndefined();
    for (const table of [ctx.schema.scenarios, ctx.schema.ideaTags, ctx.schema.ideaMistakes]) {
      expect(ctx.db.select().from(table).all()).toHaveLength(0);
    }
  });
});

describe("tag groups", () => {
  it("blocks renaming and deleting the Skip reason group", async () => {
    const { SKIP_REASON_GROUP } = ctx.schema;
    const before = ctx.db.select().from(ctx.schema.tags).all().filter((t) => t.group === SKIP_REASON_GROUP).length;
    expect(before).toBeGreaterThan(0);
    const r = await ctx.actions.renameTagGroup(SKIP_REASON_GROUP, "Other");
    expect(r.ok).toBe(false);
    const d = await ctx.actions.deleteTagGroup(SKIP_REASON_GROUP);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toMatch(/Skip reason/);
    expect(ctx.db.select().from(ctx.schema.tags).all().filter((t) => t.group === SKIP_REASON_GROUP)).toHaveLength(before);
  });

  it("renames, merges and refuses clashing merges", async () => {
    const { tags } = ctx.schema;
    ctx.db.insert(tags).values([{ name: "x", group: "A" }, { name: "y", group: "B" }, { name: "x", group: "C" }]).run();
    expect((await ctx.actions.renameTagGroup("A", "a2")).ok).toBe(true);
    expect((await ctx.actions.renameTagGroup("B", "A2")).ok).toBe(true); // merges into existing "a2" (case-insensitive)
    expect(ctx.db.select().from(tags).all().filter((t) => t.group === "a2")).toHaveLength(2);
    const clash = await ctx.actions.renameTagGroup("C", "a2"); // "x" already in a2
    expect(clash.ok).toBe(false);
    expect((await ctx.actions.renameTagGroup("C", "")).ok).toBe(false);
  });

  it("saveTag rejects case-insensitive duplicates within a group", async () => {
    expect((await ctx.actions.saveTag({ name: "Foo", group: "G", color: "#112233" })).ok).toBe(true);
    expect((await ctx.actions.saveTag({ name: "foo", group: "g", color: "#112233" })).ok).toBe(false);
  });
});

describe("deleteScenarioType", () => {
  it("removes that type's alternatives but keeps primaries", async () => {
    const st = ctx.db.insert(ctx.schema.scenarioTypes).values({ name: "Test alt type" }).returning().get().id;
    const id = await saved(idea({ scenarios: [scen(), scen({ isPrimary: false, scenarioTypeId: st })] }));
    await ctx.actions.deleteScenarioType(st);
    const v = ctx.queries.getIdea(id)!;
    expect(v.scenarios).toHaveLength(1);
    expect(v.scenarios[0].isPrimary).toBe(true);
  });
});

describe("saveIdea: only unknown tags", () => {
  it("links nothing and still saves", async () => {
    const id = await saved(idea({ tagIds: [987654] }));
    expect(ctx.queries.getIdea(id)!.tags).toEqual([]);
  });
});
