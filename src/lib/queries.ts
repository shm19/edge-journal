import "server-only";
import { and, asc, count, desc, eq, gt, lt, or, sql } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import {
  attachments,
  ideaMistakes,
  ideas,
  ideaTags,
  mistakeTypes,
  scenarios,
  scenarioTypes,
  setups,
  tags,
  type Attachment,
  type Idea,
  type MistakeType,
  type Scenario,
  type ScenarioType,
  type Setup,
  type Tag,
} from "@/db/schema";
import { tagGroupNames } from "./analytics";
import { getSettings } from "./settings";
import { mistakeCost, outcomeOf, plannedRR, scenarioR, type Outcome } from "./stats";

export interface ScenarioView extends Scenario {
  typeName: string | null;
  r: number | null;
  rr: number | null;
  outcome: Outcome;
}

export interface MistakeView {
  id: number;
  mistakeTypeId: number;
  name: string;
  note: string;
  /** Manually entered cost in R (positive = R lost). */
  costR: number | null;
  scenarioId: number | null;
  /** Alternative this mistake is measured against ("what if I hadn't…"). */
  linkedName: string | null;
  /** Effective cost in R (positive = R lost): costR, else mistakeCost(linked alternative, primary); null if unknown. */
  cost: number | null;
}

export interface IdeaView extends Idea {
  setup: Setup | null;
  tags: Tag[];
  scenarios: ScenarioView[];
  primary: ScenarioView | null;
  attachments: Attachment[];
  mistakes: MistakeView[];
  /** Date used for ordering & stats: close time if closed, else open time. */
  date: string;
}

export function listSetups(): Setup[] {
  return db.select().from(setups).orderBy(asc(setups.name)).all();
}

export function listTags(): Tag[] {
  return db.select().from(tags).orderBy(asc(tags.group), asc(tags.name)).all();
}

export function listMistakeTypes(): MistakeType[] {
  return db.select().from(mistakeTypes).orderBy(asc(mistakeTypes.name)).all();
}

export function listScenarioTypes(): ScenarioType[] {
  return db.select().from(scenarioTypes).orderBy(asc(scenarioTypes.name)).all();
}

export function tagGroups(): string[] {
  return tagGroupNames(listTags());
}

export const getSetup = cache((id: number): Setup | undefined => db.select().from(setups).where(eq(setups.id, id)).get());

export function setupIdeaCount(setupId: number): number {
  return db.select({ n: count() }).from(ideas).where(eq(ideas.setupId, setupId)).get()?.n ?? 0;
}

/** Most recently logged coin, to pre-fill the new-idea form. */
export function lastSymbol(): string | undefined {
  return db.select({ s: ideas.symbol }).from(ideas).orderBy(desc(ideas.id)).limit(1).get()?.s;
}

/** How many ideas/scenarios use each tag, alternative type and mistake type (Settings "used by" counts). */
export function usageCounts() {
  const toMap = (rows: { id: number | null; n: number }[]) => Object.fromEntries(rows.filter((r) => r.id != null).map((r) => [r.id!, r.n]));
  return {
    tag: toMap(db.select({ id: ideaTags.tagId, n: count() }).from(ideaTags).groupBy(ideaTags.tagId).all()),
    scenarioType: toMap(db.select({ id: scenarios.scenarioTypeId, n: count() }).from(scenarios).groupBy(scenarios.scenarioTypeId).all()),
    mistakeType: toMap(db.select({ id: ideaMistakes.mistakeTypeId, n: count() }).from(ideaMistakes).groupBy(ideaMistakes.mistakeTypeId).all()),
  };
}

/** Load ideas with every relation, fully computed. A personal journal fits comfortably in memory. */
export function loadIdeas(where?: { id?: number }): IdeaView[] {
  const { beThresholdR } = getSettings();
  const ideaRows = where?.id != null ? db.select().from(ideas).where(eq(ideas.id, where.id)).all() : db.select().from(ideas).all();
  if (!ideaRows.length) return [];

  const setupById = new Map(db.select().from(setups).all().map((s) => [s.id, s]));
  const tagById = new Map(db.select().from(tags).all().map((t) => [t.id, t]));
  const typeById = new Map(db.select().from(scenarioTypes).all().map((t) => [t.id, t]));
  const ids = new Set(ideaRows.map((i) => i.id));
  // Child tables: when loading a single idea, filter in SQL instead of scanning the whole table.
  const only = (col: Parameters<typeof eq>[0]) => (where?.id != null ? eq(col, where.id) : undefined);

  const tagsByIdea = new Map<number, Tag[]>();
  for (const it of db.select().from(ideaTags).where(only(ideaTags.ideaId)).all()) {
    if (!ids.has(it.ideaId)) continue;
    const t = tagById.get(it.tagId);
    if (!t) continue;
    const list = tagsByIdea.get(it.ideaId) ?? [];
    list.push(t);
    tagsByIdea.set(it.ideaId, list);
  }

  const dirById = new Map(ideaRows.map((i) => [i.id, i.direction]));
  const scenByIdea = new Map<number, ScenarioView[]>();
  for (const s of db.select().from(scenarios).where(only(scenarios.ideaId)).orderBy(asc(scenarios.id)).all()) {
    const dir = dirById.get(s.ideaId);
    if (!dir) continue;
    const r = scenarioR(dir, s);
    const view: ScenarioView = {
      ...s,
      typeName: s.scenarioTypeId != null ? (typeById.get(s.scenarioTypeId)?.name ?? null) : null,
      r,
      rr: plannedRR(dir, s.entry, s.stop, s.target),
      outcome: outcomeOf(r, beThresholdR),
    };
    const list = scenByIdea.get(s.ideaId) ?? [];
    list.push(view);
    scenByIdea.set(s.ideaId, list);
  }

  const attByIdea = new Map<number, Attachment[]>();
  for (const a of db.select().from(attachments).where(only(attachments.ideaId)).orderBy(asc(attachments.id)).all()) {
    if (!ids.has(a.ideaId)) continue;
    const list = attByIdea.get(a.ideaId) ?? [];
    list.push(a);
    attByIdea.set(a.ideaId, list);
  }

  const mistakeTypeById = new Map(db.select().from(mistakeTypes).all().map((t) => [t.id, t]));
  const mistakesByIdea = new Map<number, (typeof ideaMistakes.$inferSelect)[]>();
  for (const m of db.select().from(ideaMistakes).where(only(ideaMistakes.ideaId)).orderBy(asc(ideaMistakes.id)).all()) {
    if (!ids.has(m.ideaId)) continue;
    const list = mistakesByIdea.get(m.ideaId) ?? [];
    list.push(m);
    mistakesByIdea.set(m.ideaId, list);
  }

  return ideaRows
    .map((i) => {
      const sc = scenByIdea.get(i.id) ?? [];
      const primary = sc.find((s) => s.isPrimary) ?? sc[0] ?? null;
      const mistakes: MistakeView[] = (mistakesByIdea.get(i.id) ?? []).map((m) => {
        const linked = m.scenarioId != null ? sc.find((s) => s.id === m.scenarioId) : undefined;
        const linkedCost = linked ? mistakeCost(i.direction, linked, primary) : null;
        return {
          id: m.id,
          mistakeTypeId: m.mistakeTypeId,
          name: mistakeTypeById.get(m.mistakeTypeId)?.name ?? "Mistake",
          note: m.note,
          costR: m.costR,
          scenarioId: linked ? m.scenarioId : null,
          linkedName: linked ? (linked.typeName ?? "Alternative") : null,
          cost: m.costR ?? linkedCost,
        };
      });
      return {
        ...i,
        setup: i.setupId != null ? (setupById.get(i.setupId) ?? null) : null,
        tags: (tagsByIdea.get(i.id) ?? []).sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name)),
        scenarios: sc,
        primary,
        attachments: attByIdea.get(i.id) ?? [],
        mistakes,
        date: i.closedAt ?? i.openedAt,
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
}

/** One idea, loaded with targeted queries. `cache()` shares the result between generateMetadata and the page. */
export const getIdea = cache((id: number): IdeaView | undefined => loadIdeas({ id })[0]);

/**
 * Neighbours in journal order (newest first: `coalesce(closed_at, opened_at) desc, id desc`, the same order loadIdeas
 * returns) without loading every idea. `newer` is the one before it in the list, `older` the one after.
 */
export function ideaNeighbours(idea: { id: number; date: string }): { newer: number | null; older: number | null } {
  const key = sql<string>`coalesce(${ideas.closedAt}, ${ideas.openedAt})`;
  const newer = db
    .select({ id: ideas.id })
    .from(ideas)
    .where(or(gt(key, idea.date), and(eq(key, idea.date), gt(ideas.id, idea.id))))
    .orderBy(asc(key), asc(ideas.id))
    .limit(1)
    .get();
  const older = db
    .select({ id: ideas.id })
    .from(ideas)
    .where(or(lt(key, idea.date), and(eq(key, idea.date), lt(ideas.id, idea.id))))
    .orderBy(desc(key), desc(ideas.id))
    .limit(1)
    .get();
  return { newer: newer?.id ?? null, older: older?.id ?? null };
}
