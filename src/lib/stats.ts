// Pure R / statistics engine. No DB or framework imports — unit tested in stats.test.ts.
import { cachedFormatter, zonedHour } from "./tz";

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
  /** Sum of R; null when there are no points (so an empty sample renders "—", never 0). */
  totalR: number | null;
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
    totalR: count ? total : null,
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
    deltaTotalR: (variant.totalR ?? 0) - (primary.totalR ?? 0),
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
  return cachedFormatter("en-US", { weekday: "short", timeZone }).format(new Date(iso));
}

export function monthOf(iso: string, timeZone = "UTC"): string {
  const parts = cachedFormatter("en-CA", { year: "numeric", month: "2-digit", timeZone }).formatToParts(new Date(iso));
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  return `${y}-${m}`;
}

// ---------- Balance simulator (hypothetical) ----------

export type BalanceMode = "compounding" | "fixed";

export interface SimPoint extends RPoint {
  /** The trade's own recorded risk, in PERCENT of the account (1 = 1%, not 0.01); null when never recorded. */
  riskPct?: number | null;
}

export interface SimOptions {
  /** Starting balance in $; must be > 0 (the URL parser guarantees it). */
  start: number;
  /** Default risk per trade in PERCENT (1 = 1%). Used for every trade, or as the fallback when useTradeRisk is on. */
  riskPct: number;
  /** compounding: risk % of the current balance. fixed: risk % of the starting balance. */
  mode: BalanceMode;
  /** Use each trade's recorded riskPct; a trade without one falls back to `riskPct` and is counted in fallbackCount. */
  useTradeRisk: boolean;
  /** $ fee charged on every simulated trade (also on breakevens); default 0. */
  feePerTrade?: number;
}

export interface SimTrade {
  id: number;
  date: string;
  r: number;
  /** The risk % actually applied to this trade. */
  riskPct: number;
  /** true when useTradeRisk was on but the trade had no recorded risk (the default was used). */
  fallback: boolean;
  /** $ result after the fee (the balance change). */
  pnl: number;
  /** Balance after this trade. */
  balance: number;
}

export interface SimResult {
  start: number;
  trades: SimTrade[];
  /** Balance after the last simulated trade (== start for zero trades). */
  end: number;
  pnl: number;
  /** Return in percent of the starting balance; null with zero trades. */
  returnPct: number | null;
  /** Largest peak-to-trough fall in $ / in % of that peak (each maximised separately), peak starting at `start`. */
  maxDrawdown: number;
  maxDrawdownPct: number;
  /** Best / worst single-trade $ result; null when no trade won / lost. */
  largestWin: number | null;
  largestLoss: number | null;
  /** Balance reached 0 or below: the account is blown, the balance is clamped to 0 and later trades are NOT simulated. */
  ruined: boolean;
  /** How many trades were not simulated because of ruin. */
  skippedAfterRuin: number;
  /** Trades that used the default risk because they had no recorded one (only when useTradeRisk). */
  fallbackCount: number;
}

/**
 * Hypothetical account balance if every trade had risked the stated %. Per trade (in closing-date order):
 * pnl = base × riskPct/100 × R − fee, base = current balance (compounding) or the starting balance (fixed).
 * A recorded riskPct of 0 (or less) is treated as missing (fallback). Nothing is rounded here (display only).
 * Ruin: when the balance reaches <= 0 (or float dust below 1e-9 × start) it is clamped to 0, the loss of that
 * trade is only what was left, and the remaining trades are not simulated (risk of a non-positive balance is never
 * computed, so there is no "negative risk" maths). Zero trades: result with end == start and null return.
 */
export function simulateBalance(points: SimPoint[], o: SimOptions): SimResult {
  const fee = o.feePerTrade ?? 0;
  const sorted = [...points].sort(byDate);
  const trades: SimTrade[] = [];
  let balance = o.start;
  let peak = o.start;
  let maxDd = 0;
  let maxDdPct = 0;
  let win: number | null = null;
  let loss: number | null = null;
  let fallbackCount = 0;
  let ruined = false;

  for (const p of sorted) {
    const recorded = o.useTradeRisk && p.riskPct != null && p.riskPct > 0; // a recorded 0 counts as missing
    const fallback = o.useTradeRisk && !recorded;
    const riskPct = recorded ? p.riskPct! : o.riskPct;
    const base = o.mode === "compounding" ? balance : o.start;
    let pnl = base * (riskPct / 100) * p.r - fee;
    if (balance + pnl < 1e-9 * o.start) {
      pnl = -balance;
      ruined = true;
    }
    balance += pnl;
    if (fallback) fallbackCount++;
    trades.push({ id: p.id, date: p.date, r: p.r, riskPct, fallback, pnl, balance });
    if (pnl > 0) win = win == null ? pnl : Math.max(win, pnl);
    if (pnl < 0) loss = loss == null ? pnl : Math.min(loss, pnl);
    peak = Math.max(peak, balance);
    maxDd = Math.max(maxDd, peak - balance);
    maxDdPct = Math.max(maxDdPct, ((peak - balance) / peak) * 100);
    if (ruined) break;
  }

  return {
    start: o.start,
    trades,
    end: balance,
    pnl: balance - o.start,
    returnPct: trades.length ? ((balance - o.start) / o.start) * 100 : null,
    maxDrawdown: maxDd,
    maxDrawdownPct: maxDdPct,
    largestWin: win,
    largestLoss: loss,
    ruined,
    skippedAfterRuin: sorted.length - trades.length,
    fallbackCount,
  };
}
