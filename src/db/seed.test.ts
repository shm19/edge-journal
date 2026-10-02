import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { tempDb } from "../../test/db";

async function load() {
  await tempDb();
  const { db } = await import("@/db");
  const schema = await import("@/db/schema");
  const seed = await import("@/db/seed");
  return { db, schema, seed };
}
let ctx: Awaited<ReturnType<typeof load>>;
beforeEach(async () => {
  ctx = await load();
});

const setting = (key: string) => ctx.db.select().from(ctx.schema.settings).where(eq(ctx.schema.settings.key, key)).get()?.value;

describe("fresh DB seed", () => {
  it("has setups, scenario types, mistake types, tags and the current seed version", () => {
    const { db, schema, seed } = ctx;
    expect(db.select().from(schema.setups).all().length).toBeGreaterThan(5);
    expect(db.select().from(schema.scenarioTypes).all().map((t) => t.name)).toContain("BE stop");
    expect(db.select().from(schema.mistakeTypes).all().map((t) => t.name)).toContain("Moved stop to BE");
    const groups = new Set(db.select().from(schema.tags).all().map((t) => t.group));
    expect(groups).toEqual(new Set(["Level", "Approach", "Candle", "Context", schema.SKIP_REASON_GROUP]));
    expect(groups.has("Mistake")).toBe(false);
    expect(setting("seedVersion")).toBe(String(seed.SEED_VERSION));
    expect(setting("symbols")).toBe("BTC,ETH,SOL,XAUT");
    expect(setting("timezone")).toBeUndefined();
  });

  it("is idempotent", () => {
    const { db, schema, seed } = ctx;
    const n = db.select().from(schema.setups).all().length;
    seed.seedIfEmpty(db);
    expect(db.select().from(schema.setups).all().length).toBe(n);
  });
});

describe("upgrade from seed version 1", () => {
  it("adds skip reasons, converts Mistake tags to mistake entries, drops the timezone and stamps the version", () => {
    const { db, schema, seed } = ctx;
    // Rebuild a v1-era DB: no version row, a timezone, no mistake types, no skip reasons, a "Mistake" tag in use.
    db.delete(schema.settings).where(eq(schema.settings.key, "seedVersion")).run();
    db.insert(schema.settings).values({ key: "timezone", value: "Europe/Berlin" }).run();
    db.delete(schema.mistakeTypes).run();
    db.delete(schema.tags).where(eq(schema.tags.group, schema.SKIP_REASON_GROUP)).run();
    const tag = db.insert(schema.tags).values({ name: "Revenge", group: "Mistake", color: "#ef4444" }).returning().get();
    const odd = db.insert(schema.tags).values({ name: "Homemade error", group: "Mistake", color: "#ef4444" }).returning().get();
    const idea = db
      .insert(schema.ideas)
      .values({ symbol: "BTC", direction: "long", status: "taken", openedAt: "2026-09-01T10:00:00.000Z" })
      .returning()
      .get();
    db.insert(schema.ideaTags).values([{ ideaId: idea.id, tagId: tag.id }, { ideaId: idea.id, tagId: odd.id }]).run();

    seed.seedIfEmpty(db);

    expect(setting("seedVersion")).toBe(String(seed.SEED_VERSION));
    expect(setting("timezone")).toBeUndefined();
    expect(db.select().from(schema.tags).where(eq(schema.tags.group, "Mistake")).all()).toHaveLength(0);
    expect(db.select().from(schema.tags).where(eq(schema.tags.group, schema.SKIP_REASON_GROUP)).all().length).toBeGreaterThan(0);
    const types = new Map(db.select().from(schema.mistakeTypes).all().map((t) => [t.name, t.id]));
    expect(types.has("Revenge")).toBe(true); // seeded type reused
    expect(types.has("Homemade error")).toBe(true); // unknown tag becomes a new type
    const entries = db.select().from(schema.ideaMistakes).where(eq(schema.ideaMistakes.ideaId, idea.id)).all();
    expect(entries.map((m) => m.mistakeTypeId).sort()).toEqual([types.get("Revenge")!, types.get("Homemade error")!].sort());
    expect(db.select().from(schema.ideaTags).all()).toHaveLength(0);
  });

  it("does nothing once current (does not re-add deleted seed data)", () => {
    const { db, schema, seed } = ctx;
    db.delete(schema.mistakeTypes).run();
    seed.seedIfEmpty(db);
    expect(db.select().from(schema.mistakeTypes).all()).toHaveLength(0);
  });
});
