// Pure analytics over IdeaView[]: filters, dimensions, comparisons. No DB access (types only from ./queries), so it is
// unit-testable and importable anywhere. DB reads live in queries.ts.
import { IDEA_STATUSES, type IdeaStatus } from "@/db/schema";
import type { IdeaView } from "./queries";
import { BIAS_LABEL, EXIT_LABEL, REGIME_LABEL, STATUS_LABEL } from "./format";
import { isOpen } from "./status";
import { compareScenarios, monthOf, sessionOf, weekdayOf, type ComparisonPair, type RPoint } from "./stats";
import { zonedDate } from "./tz";

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
    status: statusRaw ? (statusRaw.split(",").filter((s) => (IDEA_STATUSES as readonly string[]).includes(s)) as IdeaStatus[]) : undefined,
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
    if (f.open && !isOpen(i)) return false;
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

export function rrBucket(rr: number | null | undefined): string {
  if (rr == null) return "No target";
  if (rr < 1) return "< 1";
  if (rr < 1.5) return "1 – 1.5";
  if (rr < 2) return "1.5 – 2";
  if (rr < 3) return "2 – 3";
  return "3+";
}

/** Group key for ideas with no tag in the grouped dimension (instead of a group literally called "—"). */
export const NO_TAG = "No tag";

export function dimensionKeys(dim: string): (p: StatPoint) => string[] {
  if (dim.startsWith("group:")) {
    const group = dim.slice(6);
    return (p) => {
      const names = p.idea.tags.filter((t) => t.group === group).map((t) => t.name);
      return names.length ? names : [NO_TAG];
    };
  }
  switch (dim) {
    case "tag":
      return (p) => (p.idea.tags.length ? p.idea.tags.map((t) => t.name) : [NO_TAG]);
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

export function tagGroupNames(tags: { group: string }[]): string[] {
  return [...new Set(tags.map((t) => t.group))].sort();
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

/**
 * Per mistake type: how often it happened and the total measured cost (positive = R lost). Each row sums that type's
 * own delta per mistake, so rows are NOT additive across types when two mistakes share an alternative on one trade
 * (use tradeMistakeCost for a trade's total). `costKnown < count` means the total is partial.
 */
export function mistakeSummary(list: IdeaView[]) {
  const map = new Map<string, { name: string; count: number; costKnown: number; cost: number }>();
  for (const i of list) {
    for (const m of i.mistakes) {
      const row = map.get(m.name) ?? { name: m.name, count: 0, costKnown: 0, cost: 0 };
      row.count++;
      if (m.cost != null) {
        row.costKnown++;
        row.cost += m.cost;
      }
      map.set(m.name, row);
    }
  }
  return [...map.values()].sort((a, b) => b.cost - a.cost || b.count - a.count);
}
