// Pure R / statistics engine. No DB or framework imports — unit tested in stats.test.ts.
import { zonedHour } from "./tz";

export type Dir = "long" | "short";
export type Outcome = "win" | "loss" | "be" | "open";

export function riskDistance(entry: number, stop: number): number {
  return Math.abs(entry - stop);
}

/** Realized R of a scenario, or null while it is still open / invalid. */
export function realizedR(dir: Dir, entry: number, stop: number, exit: number | null | undefined): number | null {
  if (exit == null || !Number.isFinite(exit)) return null;
  const risk = riskDistance(entry, stop);
  if (risk === 0) return null;
  const sign = dir === "long" ? 1 : -1;
  return (sign * (exit - entry)) / risk;
}

/** R of a scenario including special exits: "not filled" counts as 0R (no trade happened). */
export function scenarioR(
  dir: Dir,
  s: { entry: number; stop: number; exitPrice: number | null; exitReason: string | null },
): number | null {
  if (s.exitReason === "not_filled") return 0;
  return realizedR(dir, s.entry, s.stop, s.exitPrice);
}

/** Planned reward:risk to the target (FTA). */
export function plannedRR(dir: Dir, entry: number, stop: number, target: number | null | undefined): number | null {
  if (target == null || !Number.isFinite(target)) return null;
  const risk = riskDistance(entry, stop);
  if (risk === 0) return null;
  const sign = dir === "long" ? 1 : -1;
  return (sign * (target - entry)) / risk;
}

/** True when the stop sits on the losing side of entry (long: below, short: above). */
export function stopIsValid(dir: Dir, entry: number, stop: number): boolean {
  return dir === "long" ? stop < entry : stop > entry;
}

/** Fields of a scenario needed to score it. */
export interface ScenarioPrices {
  entry: number;
  stop: number;
  exitPrice: number | null;
  exitReason: string | null;
}

/**
 * R a mistake cost, measured as (alternative R − primary R); positive = R was lost, negative = the mistake "saved" R.
 * Null when either scenario is missing, still open, or has zero risk.
 */
export function mistakeCost(dir: Dir, alt: ScenarioPrices | null | undefined, primary: ScenarioPrices | null | undefined): number | null {
  if (!alt || !primary) return null;
  const a = scenarioR(dir, alt);
  const p = scenarioR(dir, primary);
  return a == null || p == null ? null : a - p;
}

/**
 * Total mistake cost of ONE trade. Mistakes measured against the same alternative describe the same lost R, so each
 * alternative's delta counts once; manually entered costs are independent and always count. Null if nothing is known.
 */
export function tradeMistakeCost(mistakes: { costR: number | null; scenarioId: number | null; cost: number | null }[]): number | null {
  let total = 0;
  let known = false;
  const seen = new Set<number>();
  for (const m of mistakes) {
    if (m.cost == null) continue;
    if (m.costR == null && m.scenarioId != null) {
      if (seen.has(m.scenarioId)) continue;
      seen.add(m.scenarioId);
    }
    total += m.cost;
    known = true;
  }
  return known ? total : null;
}

export function outcomeOf(r: number | null, beThreshold: number): Outcome {
  if (r == null) return "open";
  if (Math.abs(r) <= beThreshold) return "be";
  return r > 0 ? "win" : "loss";
}

export interface RPoint {
  id: number;
  r: number;
  date: string; // ISO, used for ordering equity curves / drawdown
  followedPlan?: boolean | null;
}

export interface Summary {
  count: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number | null; // wins / count
  avgWin: number | null;
  avgLoss: number | null;
  expectancy: number | null; // mean R
  totalR: number;
  profitFactor: number | null; // null = no losses yet (∞)
  maxDrawdown: number; // in R, positive number
  longestWinStreak: number;
  longestLossStreak: number;
  best: number | null;
  worst: number | null;
  followedPlanPct: number | null;
}

const byDate = (a: RPoint, b: RPoint) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id);

export function summarize(points: RPoint[], beThreshold = 0.1): Summary {
  const sorted = [...points].sort(byDate);
  let wins = 0,
    losses = 0,
    breakevens = 0,
    sumWin = 0,
    sumLoss = 0,
    total = 0,
    peak = 0,
    maxDd = 0,
    curWin = 0,
    curLoss = 0,
    bestWin = 0,
    bestLoss = 0,
    planKnown = 0,
    planYes = 0;
  let best: number | null = null;
  let worst: number | null = null;

  for (const p of sorted) {
    const o = outcomeOf(p.r, beThreshold);
    total += p.r;
    peak = Math.max(peak, total);
    maxDd = Math.max(maxDd, peak - total);
    best = best == null ? p.r : Math.max(best, p.r);
    worst = worst == null ? p.r : Math.min(worst, p.r);
    if (o === "win") {
      wins++;
      sumWin += p.r;
      curWin++;
      curLoss = 0;
    } else if (o === "loss") {
      losses++;
      sumLoss += p.r;
      curLoss++;
      curWin = 0;
    } else {
      breakevens++;
      curWin = 0;
      curLoss = 0;
    }
    bestWin = Math.max(bestWin, curWin);
    bestLoss = Math.max(bestLoss, curLoss);
    if (p.followedPlan != null) {
      planKnown++;
      if (p.followedPlan) planYes++;
    }
  }

  const count = sorted.length;
  return {
    count,
    wins,
    losses,
    breakevens,
    winRate: count ? wins / count : null,
    avgWin: wins ? sumWin / wins : null,
    avgLoss: losses ? sumLoss / losses : null,
    expectancy: count ? total / count : null,
    totalR: total,
    profitFactor: losses ? sumWin / Math.abs(sumLoss) : null,
    maxDrawdown: maxDd,
    longestWinStreak: bestWin,
    longestLossStreak: bestLoss,
    best,
    worst,
    followedPlanPct: planKnown ? planYes / planKnown : null,
  };
}

export interface EquityPoint {
  id: number;
  date: string;
  r: number;
  cum: number;
  n: number;
}

export function equityCurve(points: RPoint[]): EquityPoint[] {
  let cum = 0;
  return [...points].sort(byDate).map((p, i) => {
    cum += p.r;
    return { id: p.id, date: p.date, r: p.r, cum, n: i + 1 };
  });
}

/** Group points by one or more keys per point (a point with several tags lands in several groups). */
export function groupSummaries<T extends RPoint>(
  points: T[],
  keysOf: (p: T) => string[],
  beThreshold = 0.1,
): { key: string; summary: Summary; points: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const p of points) {
    const keys = [...new Set(keysOf(p))];
    for (const k of keys.length ? keys : ["—"]) {
      const list = groups.get(k);
      if (list) list.push(p);
      else groups.set(k, [p]);
    }
  }
  return [...groups.entries()].map(([key, pts]) => ({ key, summary: summarize(pts, beThreshold), points: pts }));
}

export interface ComparisonPair {
  ideaId: number;
  date: string;
  primaryR: number;
  variantR: number;
}

export interface Comparison {
  pairs: number;
  primary: Summary;
  variant: Summary;
  deltaTotalR: number;
  deltaExpectancy: number | null;
  deltaWinRate: number | null;
  variantBetterCount: number;
}

/** Compare the actual (primary) scenario against an alternative across all ideas that have both closed. */
export function compareScenarios(pairs: ComparisonPair[], beThreshold = 0.1): Comparison {
  const primary = summarize(
    pairs.map((p) => ({ id: p.ideaId, r: p.primaryR, date: p.date })),
    beThreshold,
  );
  const variant = summarize(
    pairs.map((p) => ({ id: p.ideaId, r: p.variantR, date: p.date })),
    beThreshold,
  );
  const sub = (a: number | null, b: number | null) => (a == null || b == null ? null : a - b);
  return {
    pairs: pairs.length,
    primary,
    variant,
    deltaTotalR: variant.totalR - primary.totalR,
    deltaExpectancy: sub(variant.expectancy, primary.expectancy),
    deltaWinRate: sub(variant.winRate, primary.winRate),
    variantBetterCount: pairs.filter((p) => p.variantR > p.primaryR).length,
  };
}

export interface SkipAudit {
  count: number;
  leftOnTable: number; // sum of positive R you didn't take
  lossesAvoided: number; // sum of |negative R| you didn't take
  net: number; // what taking all of them would have added
  summary: Summary;
}

export function skipAudit(points: RPoint[], beThreshold = 0.1): SkipAudit {
  let pos = 0,
    neg = 0;
  for (const p of points) {
    if (p.r > 0) pos += p.r;
    else neg += -p.r;
  }
  return { count: points.length, leftOnTable: pos, lossesAvoided: neg, net: pos - neg, summary: summarize(points, beThreshold) };
}

export type Confidence = "none" | "low" | "early" | "solid";

export function sampleConfidence(n: number): Confidence {
  if (n === 0) return "none";
  if (n < 20) return "low";
  if (n <= 50) return "early";
  return "solid";
}

/**
 * Trading session of an instant, DST-aware:
 * London 07:00–16:00 London time, New York 08:00–17:00 NY time, Asia 09:00–18:00 Tokyo time.
 */
export function sessionOf(iso: string): string {
  const inRange = (tz: string, from: number, to: number) => {
    const h = zonedHour(iso, tz);
    return h >= from && h < to;
  };
  const london = inRange("Europe/London", 7, 16);
  const ny = inRange("America/New_York", 8, 17);
  if (london && ny) return "London/NY overlap";
  if (london) return "London";
  if (ny) return "New York";
  if (inRange("Asia/Tokyo", 9, 18)) return "Asia";
  return "After hours";
}

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function weekdayOf(iso: string, timeZone = "UTC"): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone }).format(new Date(iso));
}

export function monthOf(iso: string, timeZone = "UTC"): string {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone }).formatToParts(new Date(iso));
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  return `${y}-${m}`;
}
