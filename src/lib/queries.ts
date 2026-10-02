import "server-only";
import { asc, eq } from "drizzle-orm";
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
  type IdeaStatus,
  type MistakeType,
  type Scenario,
  type ScenarioType,
  type Setup,
  type Tag,
} from "@/db/schema";
import { getSettings } from "./settings";
import {
  compareScenarios,
  monthOf,
  outcomeOf,
  plannedRR,
  scenarioR,
  sessionOf,
  weekdayOf,
  type ComparisonPair,
  type Outcome,
  type RPoint,
} from "./stats";
import { BIAS_LABEL, EXIT_LABEL, REGIME_LABEL, STATUS_LABEL } from "./format";
import { zonedDate } from "./tz";

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
  /** Effective cost: costR, else linked alternative R − primary R; null if unknown. */
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

/** Load ideas with every relation, fully computed. A personal journal fits comfortably in memory. */
export function loadIdeas(where?: { id?: number }): IdeaView[] {
  const { beThresholdR } = getSettings();
  const ideaRows = where?.id != null ? db.select().from(ideas).where(eq(ideas.id, where.id)).all() : db.select().from(ideas).all();
  if (!ideaRows.length) return [];

  const setupById = new Map(db.select().from(setups).all().map((s) => [s.id, s]));
  const tagById = new Map(db.select().from(tags).all().map((t) => [t.id, t]));
  const typeById = new Map(db.select().from(scenarioTypes).all().map((t) => [t.id, t]));
  const ids = new Set(ideaRows.map((i) => i.id));

  const tagsByIdea = new Map<number, Tag[]>();
  for (const it of db.select().from(ideaTags).all()) {
    if (!ids.has(it.ideaId)) continue;
    const t = tagById.get(it.tagId);
    if (!t) continue;
    const list = tagsByIdea.get(it.ideaId) ?? [];
    list.push(t);
    tagsByIdea.set(it.ideaId, list);
  }

  const dirById = new Map(ideaRows.map((i) => [i.id, i.direction]));
  const scenByIdea = new Map<number, ScenarioView[]>();
  for (const s of db.select().from(scenarios).orderBy(asc(scenarios.id)).all()) {
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
  for (const a of db.select().from(attachments).orderBy(asc(attachments.id)).all()) {
    if (!ids.has(a.ideaId)) continue;
    const list = attByIdea.get(a.ideaId) ?? [];
    list.push(a);
    attByIdea.set(a.ideaId, list);
  }

  const mistakeTypeById = new Map(db.select().from(mistakeTypes).all().map((t) => [t.id, t]));
  const mistakesByIdea = new Map<number, (typeof ideaMistakes.$inferSelect)[]>();
  for (const m of db.select().from(ideaMistakes).orderBy(asc(ideaMistakes.id)).all()) {
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
        const linkedCost = linked?.r != null && primary?.r != null ? linked.r - primary.r : null;
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

export function getIdea(id: number): IdeaView | undefined {
  return loadIdeas({ id })[0];
}

// ---------- Filtering ----------

export interface IdeaFilters {
  status?: IdeaStatus[];
  setupId?: number;
  symbol?: string;
  tagId?: number;
  timeframe?: string;
  bias?: string;
  direction?: string;
  from?: string; // YYYY-MM-DD
  to?: string;
  q?: string;
  /** Only ideas whose primary scenario is still open (no exit yet). */
  open?: boolean;
}

export function parseFilters(sp: Record<string, string | string[] | undefined>): IdeaFilters {
  const one = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) || undefined;
  };
  const statusRaw = one("status");
  const num = (k: string) => {
    const v = Number(one(k));
    return Number.isFinite(v) && v > 0 ? v : undefined;
  };
  return {
    status: statusRaw ? (statusRaw.split(",").filter((s) => s in STATUS_LABEL) as IdeaStatus[]) : undefined,
    setupId: num("setup"),
    symbol: one("symbol"),
    tagId: num("tag"),
    timeframe: one("tf"),
    bias: one("bias"),
    direction: one("dir"),
    from: one("from"),
    to: one("to"),
    q: one("q"),
    open: one("open") === "1",
  };
}

export function applyFilters(list: IdeaView[], f: IdeaFilters): IdeaView[] {
  const q = f.q?.toLowerCase();
  return list.filter((i) => {
    if (f.status && !f.status.includes(i.status)) return false;
    if (f.setupId && i.setupId !== f.setupId) return false;
    if (f.symbol && i.symbol !== f.symbol) return false;
    if (f.tagId && !i.tags.some((t) => t.id === f.tagId)) return false;
    if (f.timeframe && i.entryTimeframe !== f.timeframe) return false;
    if (f.bias && i.htfBias !== f.bias) return false;
    if (f.direction && i.direction !== f.direction) return false;
    if (f.open && !(i.primary && i.primary.r == null && i.outcome == null)) return false;
    if (f.from || f.to) {
      // Same date the journal shows: the open date (UTC).
      const day = zonedDate(i.openedAt);
      if (f.from && day < f.from) return false;
      if (f.to && day > f.to) return false;
    }
    if (q) {
      const hay = [i.symbol, i.thesis, i.review, i.skipReason, i.invalidation, i.setup?.name ?? "", ...i.tags.map((t) => t.name)]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// ---------- Analytics ----------

export interface StatPoint extends RPoint {
  idea: IdeaView;
}

/** Closed primary scenarios → R points. */
export function primaryPoints(list: IdeaView[]): StatPoint[] {
  return list
    .filter((i) => i.primary?.r != null)
    .map((i) => ({ id: i.id, r: i.primary!.r!, date: i.date, followedPlan: i.followedPlan, idea: i }));
}

export const DIMENSIONS = [
  { key: "setup", label: "Setup" },
  { key: "tag", label: "Any tag" },
  { key: "mistake", label: "Mistake" },
  { key: "symbol", label: "Coin" },
  { key: "timeframe", label: "Entry timeframe" },
  { key: "direction", label: "Direction" },
  { key: "status", label: "Status" },
  { key: "bias", label: "HTF bias" },
  { key: "regime", label: "Range / trend" },
  { key: "session", label: "Session" },
  { key: "weekday", label: "Weekday" },
  { key: "month", label: "Month" },
  { key: "followedPlan", label: "Followed plan" },
  { key: "exitReason", label: "Exit reason" },
  { key: "plannedRR", label: "Planned R:R" },
  { key: "confidence", label: "Confidence" },
  { key: "checklist", label: "Checklist score" },
] as const;

export function isDimension(key: string, groups: string[]): boolean {
  return DIMENSIONS.some((d) => d.key === key) || (key.startsWith("group:") && groups.includes(key.slice(6)));
}

function rrBucket(rr: number | null | undefined): string {
  if (rr == null) return "No target";
  if (rr < 1) return "< 1";
  if (rr < 1.5) return "1 – 1.5";
  if (rr < 2) return "1.5 – 2";
  if (rr < 3) return "2 – 3";
  return "3+";
}

export function dimensionKeys(dim: string): (p: StatPoint) => string[] {
  if (dim.startsWith("group:")) {
    const group = dim.slice(6);
    return (p) => p.idea.tags.filter((t) => t.group === group).map((t) => t.name);
  }
  switch (dim) {
    case "tag":
      return (p) => p.idea.tags.map((t) => t.name);
    case "mistake":
      return (p) => (p.idea.mistakes.length ? p.idea.mistakes.map((m) => m.name) : ["No mistake"]);
    case "symbol":
      return (p) => [p.idea.symbol];
    case "timeframe":
      return (p) => [p.idea.entryTimeframe ?? "—"];
    case "direction":
      return (p) => [p.idea.direction === "long" ? "Long" : "Short"];
    case "status":
      return (p) => [STATUS_LABEL[p.idea.status]];
    case "bias":
      return (p) => [p.idea.htfBias ? BIAS_LABEL[p.idea.htfBias] : "—"];
    case "regime":
      return (p) => [p.idea.regime ? REGIME_LABEL[p.idea.regime] : "—"];
    case "session":
      return (p) => [sessionOf(p.idea.openedAt)];
    case "weekday":
      return (p) => [weekdayOf(p.idea.openedAt)];
    case "month":
      return (p) => [monthOf(p.date)];
    case "followedPlan":
      return (p) => [p.idea.followedPlan == null ? "—" : p.idea.followedPlan ? "Yes" : "No"];
    case "exitReason":
      return (p) => [p.idea.primary?.exitReason ? EXIT_LABEL[p.idea.primary.exitReason] : "—"];
    case "plannedRR":
      return (p) => [rrBucket(p.idea.primary?.rr)];
    case "confidence":
      return (p) => [p.idea.confidence ? `${p.idea.confidence}/5` : "—"];
    case "checklist":
      return (p) => {
        const items = p.idea.setup?.checklist ?? [];
        if (!items.length) return ["No checklist"];
        const pct = items.filter((c) => p.idea.checklistState[c]).length / items.length;
        return [pct === 1 ? "All checked" : pct >= 0.5 ? "Half or more" : "Less than half"];
      };
    case "setup":
    default:
      return (p) => [p.idea.setup?.name ?? "No setup"];
  }
}

export function tagGroups(): string[] {
  return [...new Set(listTags().map((t) => t.group))].sort();
}

/** For every scenario type: primary vs that alternative across ideas where both are closed. */
export function scenarioComparisons(list: IdeaView[], beThreshold: number) {
  const byType = new Map<string, ComparisonPair[]>();
  for (const i of list) {
    const p = i.primary;
    if (p?.r == null) continue;
    for (const s of i.scenarios) {
      if (s.isPrimary || s.r == null) continue;
      const name = s.typeName ?? "Untyped alternative";
      const pairs = byType.get(name) ?? [];
      pairs.push({ ideaId: i.id, date: i.date, primaryR: p.r, variantR: s.r });
      byType.set(name, pairs);
    }
  }
  return [...byType.entries()]
    .map(([name, pairs]) => ({ name, ...compareScenarios(pairs, beThreshold) }))
    .sort((a, b) => b.pairs - a.pairs);
}

/** Hit / miss stats for observation-only forward tests. */
export function observationStats(list: IdeaView[]) {
  const obs = list.filter((i) => i.outcome != null);
  const hits = obs.filter((i) => i.outcome === "hit").length;
  return { count: obs.length, hits, misses: obs.length - hits, hitRate: obs.length ? hits / obs.length : null };
}

/** Per mistake type: how often, total R of those trades, and total measured cost. */
export function mistakeSummary(list: IdeaView[]) {
  const map = new Map<string, { name: string; count: number; costKnown: number; cost: number; tradeR: number; ideaIds: number[] }>();
  for (const i of list) {
    for (const m of i.mistakes) {
      const row = map.get(m.name) ?? { name: m.name, count: 0, costKnown: 0, cost: 0, tradeR: 0, ideaIds: [] };
      row.count++;
      row.ideaIds.push(i.id);
      if (m.cost != null) {
        row.costKnown++;
        row.cost += m.cost;
      }
      if (i.primary?.r != null) row.tradeR += i.primary.r;
      map.set(m.name, row);
    }
  }
  return [...map.values()].sort((a, b) => b.cost - a.cost || b.count - a.count);
}
