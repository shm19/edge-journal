import type { Bias, ExitReason, IdeaStatus, Regime } from "@/db/schema";
import { APP_TIMEZONE, cachedFormatter } from "./tz";

export function fmtR(r: number | null | undefined, digits = 2): string {
  if (r == null || !Number.isFinite(r)) return "—";
  const s = r.toFixed(digits);
  return `${r > 0 ? "+" : ""}${s}R`;
}

/** Cost of a mistake (positive = R lost) as a signed R amount: lost R is negative, "saved" R positive. */
export function fmtCost(cost: number | null | undefined, digits = 2): string {
  return cost == null ? "—" : fmtR(-cost, digits);
}

/** Profit factor: "∞" when there are wins but no losses, "—" when there is nothing to show. */
export function fmtProfitFactor(s: { profitFactor: number | null; wins: number }): string {
  return s.profitFactor == null ? (s.wins ? "∞" : "—") : fmtNum(s.profitFactor);
}

/** Max drawdown as a negative R amount; a real zero (all-win sample) is "0.00R", "—" only when there are no trades. */
export function fmtDrawdown(s: { maxDrawdown: number; count: number }): string {
  if (!s.count) return "—";
  return s.maxDrawdown ? `-${s.maxDrawdown.toFixed(2)}R` : "0.00R";
}

export function fmtPct(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

/** Dollar amount with 2 decimals ("$1,009.80"); `signed` adds "+" to gains. Rounding happens here only. */
export function fmtMoney(v: number | null | undefined, signed = false): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = `$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return v < 0 && Number(Math.abs(v).toFixed(2)) !== 0 ? `-${s}` : signed && v > 0 ? `+${s}` : s;
}

/** A value that is already in percent ("+24.00%"), signed. */
export function fmtPctPoints(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = v.toFixed(digits);
  const n = Number(s); // a value that rounds to zero is "0.00%", never "-0.00%"
  return `${n > 0 ? "+" : ""}${n === 0 ? (0).toFixed(digits) : s}%`;
}

export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

/** Price formatting that keeps meaningful decimals for both BTC (60000) and small alts (0.000123). */
export function fmtPrice(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : 8;
  return Number(v.toFixed(digits)).toLocaleString("en-US", { maximumFractionDigits: digits });
}

/** Date + time, always in UTC, with a "UTC" marker. */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = cachedFormatter("en-GB", {
    timeZone: APP_TIMEZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
  return `${s} UTC`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return cachedFormatter("en-GB", { timeZone: APP_TIMEZONE, day: "2-digit", month: "short", year: "2-digit" }).format(new Date(iso));
}

export function rTone(r: number | null | undefined, be = 0.1): "win" | "loss" | "be" | "none" {
  if (r == null) return "none";
  if (Math.abs(r) <= be) return "be";
  return r > 0 ? "win" : "loss";
}

export const STATUS_LABEL: Record<IdeaStatus, string> = {
  taken: "Taken",
  skipped: "Skipped",
  missed: "Missed",
  forward_test: "Forward test",
  backtest: "Backtest",
};

export const BIAS_LABEL: Record<Bias, string> = { with: "With HTF", against: "Against HTF", neutral: "Neutral" };
export const REGIME_LABEL: Record<Regime, string> = { range: "Range", trend: "Trend", unclear: "Unclear" };
export const EXIT_LABEL: Record<ExitReason, string> = {
  target: "Target",
  stop: "Stop",
  invalidation: "Invalidation",
  manual: "Manual",
  be: "Breakeven",
  time: "Time",
  not_filled: "Not filled",
  open: "Still open",
};
