import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tempDb } from "../../test/db";

vi.mock("@/lib/auth", () => ({ isAuthenticated: vi.fn(async () => true) }));

async function load() {
  await tempDb();
  const queries = await import("@/lib/queries");
  const actions = await import("@/lib/actions");
  const { db } = await import("@/db");
  const schema = await import("@/db/schema");
  return { queries, actions, db, schema };
}
let ctx: Awaited<ReturnType<typeof load>>;
beforeEach(async () => {
  ctx = await load();
});

const base = {
  symbol: "BTC",
  direction: "long",
  status: "taken",
  setupId: null,
  entryTimeframe: null,
  htfBias: null,
  regime: null,
  openedAt: "2026-09-01T10:00:00.000Z",
  closedAt: null,
  followedPlan: null,
  riskPct: null,
  feesUsd: null,
  pnlUsd: null,
  confidence: null,
};
const sc = (o: Record<string, unknown> = {}) => ({
  scenarioTypeId: null,
  isPrimary: true,
  entry: 100,
  stop: 90,
  target: null,
  exitPrice: 120,
  exitReason: "target",
  notes: "",
  ...o,
});
async function add(o: Record<string, unknown> = {}) {
  const res = await ctx.actions.saveIdea({ ...base, scenarios: [sc()], ...o });
  if (!res.ok) throw new Error(res.error);
  return res.data!.id;
}

describe("loadIdeas: R calculation", () => {
  it("computes R for long and short, planned R:R and outcome", async () => {
    const l = await add({ scenarios: [sc({ target: 130 })] });
    const s = await add({ direction: "short", scenarios: [sc({ entry: 100, stop: 110, exitPrice: 90, target: 70 })] });
    const byId = new Map(ctx.queries.loadIdeas().map((i) => [i.id, i]));
    expect(byId.get(l)!.primary).toMatchObject({ r: 2, rr: 3, outcome: "win" });
    expect(byId.get(s)!.primary).toMatchObject({ r: 1, rr: 3, outcome: "win" });
  });

  it("an open primary has null R; not_filled scores 0R", async () => {
    const open = await add({ scenarios: [sc({ exitPrice: null, exitReason: null })] });
    const nf = await add({ scenarios: [sc({ exitPrice: null, exitReason: "not_filled" })] });
    expect(ctx.queries.getIdea(open)!.primary).toMatchObject({ r: null, outcome: "open" });
    expect(ctx.queries.getIdea(nf)!.primary).toMatchObject({ r: 0, outcome: "be" });
  });

  it("uses the break-even band from settings", async () => {
    ctx.db.update(ctx.schema.settings).set({ value: "0.5" }).where(eq(ctx.schema.settings.key, "beThresholdR")).run();
    const id = await add({ scenarios: [sc({ exitPrice: 104 })] }); // +0.4R
    expect(ctx.queries.getIdea(id)!.primary?.outcome).toBe("be");
  });

  it("picks the flagged primary even when an alternative has a lower id", async () => {
    const id = await add({ scenarios: [sc({ isPrimary: false, exitPrice: 95 }), sc({ exitPrice: 110 })] });
    const v = ctx.queries.getIdea(id)!;
    expect(v.primary?.r).toBe(1);
    expect(v.scenarios).toHaveLength(2);
  });

  it("an observation-only forward test has no primary", async () => {
    const id = await add({ status: "forward_test", outcome: "hit", scenarios: [] });
    const v = ctx.queries.getIdea(id)!;
    expect(v.primary).toBeNull();
    expect(v.outcome).toBe("hit");
  });

  it("date is the close time when closed, else the open time", async () => {
    const a = await add({ closedAt: "2026-09-03T00:00:00.000Z" });
    const b = await add();
    expect(ctx.queries.getIdea(a)!.date).toBe("2026-09-03T00:00:00.000Z");
    expect(ctx.queries.getIdea(b)!.date).toBe(base.openedAt);
  });
});

describe("loadIdeas: mistake cost", () => {
  const mt = () => ctx.db.insert(ctx.schema.mistakeTypes).values({ name: `m${Math.random()}` }).returning().get().id;

  it("linked cost is alternative R minus primary R; manual cost wins", async () => {
    const t = mt();
    const id = await add({
      scenarios: [sc({ exitPrice: 110 }), sc({ isPrimary: false, exitPrice: 130 })],
      mistakes: [
        { mistakeTypeId: t, note: "", costR: null, scenarioIndex: 1 },
        { mistakeTypeId: t, note: "", costR: 0.25, scenarioIndex: 1 },
        { mistakeTypeId: t, note: "", costR: null, scenarioIndex: null },
      ],
    });
    const m = ctx.queries.getIdea(id)!.mistakes;
    expect(m.map((x) => x.cost)).toEqual([2, 0.25, null]);
    expect(m[0].linkedName).toBe("Alternative");
  });

  it("is unknown while the primary is open, and a deleted alternative unlinks the mistake", async () => {
    const t = mt();
    const open = await add({
      scenarios: [sc({ exitPrice: null, exitReason: null }), sc({ isPrimary: false, exitPrice: 130 })],
      mistakes: [{ mistakeTypeId: t, note: "", costR: null, scenarioIndex: 1 }],
    });
    expect(ctx.queries.getIdea(open)!.mistakes[0].cost).toBeNull();

    const id = await add({
      scenarios: [sc(), sc({ isPrimary: false, exitPrice: 130 })],
      mistakes: [{ mistakeTypeId: t, note: "", costR: null, scenarioIndex: 1 }],
    });
    const alt = ctx.queries.getIdea(id)!.scenarios.find((s) => !s.isPrimary)!;
    ctx.db.delete(ctx.schema.scenarios).where(eq(ctx.schema.scenarios.id, alt.id)).run();
    expect(ctx.queries.getIdea(id)!.mistakes[0]).toMatchObject({ scenarioId: null, linkedName: null, cost: null });
  });
});

describe("getIdea / ideaNeighbours", () => {
  it("getIdea returns the same view as loadIdeas for that id, with only its own children", async () => {
    const t = ctx.db.insert(ctx.schema.tags).values({ name: "zz", group: "G" }).returning().get().id;
    const a = await add({ tagIds: [t], scenarios: [sc(), sc({ isPrimary: false, exitPrice: 95 })] });
    await add({ tagIds: [t] });
    const all = ctx.queries.loadIdeas().find((i) => i.id === a)!;
    expect(ctx.queries.getIdea(a)).toEqual(all);
    expect(ctx.queries.getIdea(a)!.scenarios).toHaveLength(2);
    expect(ctx.queries.getIdea(99999)).toBeUndefined();
  });

  it("neighbours follow the journal order (closed_at ?? opened_at desc, id desc), including ties", async () => {
    await add({ openedAt: "2026-09-01T10:00:00.000Z" });
    await add({ openedAt: "2026-09-05T10:00:00.000Z" });
    await add({ openedAt: "2026-09-02T10:00:00.000Z", closedAt: "2026-09-07T10:00:00.000Z" }); // sorts by close date
    await add({ openedAt: "2026-09-05T10:00:00.000Z" }); // tie with the second on date: higher id first
    await add({ openedAt: "2026-09-03T10:00:00.000Z" });
    const order = ctx.queries.loadIdeas().map((i) => i);
    expect(order).toHaveLength(5);
    order.forEach((idea, pos) => {
      expect(ctx.queries.ideaNeighbours(idea), `position ${pos}`).toEqual({
        newer: order[pos - 1]?.id ?? null,
        older: order[pos + 1]?.id ?? null,
      });
    });
  });
});

describe("small page queries", () => {
  it("lastSymbol is the most recently created idea's coin", async () => {
    expect(ctx.queries.lastSymbol()).toBeUndefined();
    await add({ symbol: "eth" });
    expect(ctx.queries.lastSymbol()).toBe("ETH");
  });

  it("getSetup / setupIdeaCount", async () => {
    const s = ctx.db.insert(ctx.schema.setups).values({ name: "Mine" }).returning().get();
    await add({ setupId: s.id });
    await add({ setupId: s.id });
    await add();
    expect(ctx.queries.getSetup(s.id)?.name).toBe("Mine");
    expect(ctx.queries.getSetup(99999)).toBeUndefined();
    expect(ctx.queries.setupIdeaCount(s.id)).toBe(2);
  });

  it("usageCounts counts tag, alternative-type and mistake-type use", async () => {
    const tag = ctx.db.insert(ctx.schema.tags).values({ name: "zz", group: "G" }).returning().get().id;
    const st = ctx.db.insert(ctx.schema.scenarioTypes).values({ name: "zz type" }).returning().get().id;
    const mt = ctx.db.insert(ctx.schema.mistakeTypes).values({ name: "zz mistake" }).returning().get().id;
    await add({
      tagIds: [tag],
      scenarios: [sc(), sc({ isPrimary: false, scenarioTypeId: st })],
      mistakes: [{ mistakeTypeId: mt, note: "", costR: 1, scenarioIndex: null }],
    });
    const u = ctx.queries.usageCounts();
    expect(u.tag[tag]).toBe(1);
    expect(u.scenarioType[st]).toBe(1);
    expect(u.mistakeType[mt]).toBe(1);
  });

  it("tagGroups lists distinct groups", async () => {
    expect(ctx.queries.tagGroups()).toContain(ctx.schema.SKIP_REASON_GROUP);
  });
});

describe("migration 0003 indexes", () => {
  it("exist on the migrated DB", async () => {
    const { sqlite } = await import("@/db");
    const names = (sqlite.prepare("select name from sqlite_master where type='index'").all() as { name: string }[]).map((r) => r.name);
    for (const n of [
      "scenarios_idea_idx",
      "scenarios_type_idx",
      "idea_mistakes_idea_idx",
      "idea_mistakes_type_idx",
      "idea_mistakes_scenario_idx",
      "attachments_idea_idx",
      "idea_tags_tag_idx",
      "ideas_setup_idx",
    ]) {
      expect(names).toContain(n);
    }
  });
});

describe("list queries", () => {
  it("return seeded rows in name order, and tags grouped then named", () => {
    const { queries } = ctx;
    const names = (rows: { name: string }[]) => rows.map((r) => r.name);
    for (const rows of [queries.listSetups(), queries.listMistakeTypes(), queries.listScenarioTypes()]) {
      expect(rows.length).toBeGreaterThan(0);
      expect(names(rows)).toEqual([...names(rows)].sort());
    }
    const tags = queries.listTags();
    expect(tags.map((t) => t.group)).toEqual([...tags.map((t) => t.group)].sort());
  });
  it("setupIdeaCount is 0 for an unused setup and getSetup is undefined for a missing one", () => {
    const { queries } = ctx;
    expect(queries.setupIdeaCount(999)).toBe(0);
    expect(queries.getSetup(999)).toBeUndefined();
  });
  it("getIdea is undefined for a missing id; loadIdeas is empty on a fresh DB", () => {
    expect(ctx.queries.getIdea(999)).toBeUndefined();
    expect(ctx.queries.loadIdeas()).toEqual([]);
  });
});

describe("orphans and fallbacks", () => {
  it("an idea shows its setup; a mistake whose type is gone is named 'Mistake'; unknown tag rows are skipped", async () => {
    const { db, schema, queries } = ctx;
    const setup = db.select().from(schema.setups).limit(1).get()!;
    const id = db.insert(schema.ideas).values({ symbol: "BTC", direction: "long", status: "taken", openedAt: "2026-09-01T10:00:00.000Z", setupId: setup.id }).returning().get().id;
    const alt = db.insert(schema.scenarioTypes).values({ name: "Fallback probe" }).returning().get();
    db.insert(schema.scenarios).values([
      { ideaId: id, isPrimary: true, entry: 100, stop: 90 },
      { ideaId: id, isPrimary: false, entry: 100, stop: 90, scenarioTypeId: alt.id, exitPrice: 120, exitReason: "target" },
    ]).run();
    const altRow = db.select().from(schema.scenarios).where(eq(schema.scenarios.isPrimary, false)).get()!;
    const type = db.insert(schema.mistakeTypes).values({ name: "Temp" }).returning().get();
    db.insert(schema.ideaMistakes).values({ ideaId: id, mistakeTypeId: type.id, scenarioId: altRow.id }).run();

    let v = queries.getIdea(id)!;
    expect(v.setup?.id).toBe(setup.id);
    expect(v.scenarios.find((s) => !s.isPrimary)?.typeName).toBe("Fallback probe");
    expect(v.mistakes[0].name).toBe("Temp");
    expect(v.mistakes[0].linkedName).toBe("Fallback probe");

    // Type-less alternative is labelled "Alternative"; deleting the mistake type cascades the entry away.
    db.update(schema.scenarios).set({ scenarioTypeId: null }).where(eq(schema.scenarios.id, altRow.id)).run();
    expect(queries.getIdea(id)!.mistakes[0].linkedName).toBe("Alternative");
    db.delete(schema.mistakeTypes).where(eq(schema.mistakeTypes.id, type.id)).run();
    v = queries.getIdea(id)!;
    expect(v.mistakes).toEqual([]);
  });

  it("drops child rows whose parent rows are missing (FKs off) instead of crashing", async () => {
    const { db, schema, queries, } = ctx;
    const { sqlite } = await import("@/db");
    const id = db.insert(schema.ideas).values({ symbol: "ETH", direction: "short", status: "taken", openedAt: "2026-09-01T10:00:00.000Z" }).returning().get().id;
    sqlite.pragma("foreign_keys = OFF");
    sqlite.exec(`INSERT INTO idea_tags (idea_id, tag_id) VALUES (${id}, 987654)`);
    sqlite.exec(`INSERT INTO scenarios (idea_id, is_primary, entry, stop) VALUES (987654, 1, 100, 90)`);
    sqlite.exec(`INSERT INTO idea_mistakes (idea_id, mistake_type_id) VALUES (${id}, 987654)`);
    sqlite.pragma("foreign_keys = ON");
    const v = queries.getIdea(id)!;
    expect(v.tags).toEqual([]);
    expect(v.scenarios).toEqual([]);
    expect(queries.loadIdeas()).toHaveLength(1);
    expect(v.mistakes[0].name).toBe("Mistake");
  });
});

describe("more fallbacks", () => {
  it("loadIdeas attaches files to their idea in id order", () => {
    const { db, schema, queries } = ctx;
    const id = db.insert(schema.ideas).values({ symbol: "BTC", direction: "long", status: "taken", openedAt: "2026-09-01T10:00:00.000Z" }).returning().get().id;
    db.insert(schema.attachments).values([{ ideaId: id, filePath: "a.png", kind: "before" }, { ideaId: id, filePath: "b.png", kind: "after" }]).run();
    expect(queries.loadIdeas()[0].attachments.map((a) => a.filePath)).toEqual(["a.png", "b.png"]);
  });
  it("a missing setup or alternative type (FKs off) degrades to null instead of crashing", async () => {
    const { db, schema, queries } = ctx;
    const { sqlite } = await import("@/db");
    const id = db.insert(schema.ideas).values({ symbol: "BTC", direction: "long", status: "taken", openedAt: "2026-09-01T10:00:00.000Z" }).returning().get().id;
    sqlite.pragma("foreign_keys = OFF");
    sqlite.exec(`UPDATE ideas SET setup_id = 987654 WHERE id = ${id}`);
    sqlite.exec(`INSERT INTO scenarios (idea_id, is_primary, entry, stop, scenario_type_id) VALUES (${id}, 1, 100, 90, 987654)`);
    sqlite.pragma("foreign_keys = ON");
    const v = queries.getIdea(id)!;
    expect(v.setup).toBeNull();
    expect(v.scenarios[0].typeName).toBeNull();
  });
});
