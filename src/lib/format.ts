import { APP_TIMEZONE } from "./tz";

export function fmtR(r: number | null | undefined, digits = 2): string {
  if (r == null || !Number.isFinite(r)) return "—";
  const s = r.toFixed(digits);
  return `${r > 0 ? "+" : ""}${s}R`;
}

export function fmtPct(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
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
  const s = new Intl.DateTimeFormat("en-GB", {
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
  return new Intl.DateTimeFormat("en-GB", { timeZone: APP_TIMEZONE, day: "2-digit", month: "short", year: "2-digit" }).format(new Date(iso));
}

export function rTone(r: number | null | undefined, be = 0.1): "win" | "loss" | "be" | "none" {
  if (r == null) return "none";
  if (Math.abs(r) <= be) return "be";
  return r > 0 ? "win" : "loss";
}

export const STATUS_LABEL: Record<string, string> = {
  taken: "Taken",
  skipped: "Skipped",
  missed: "Missed",
  forward_test: "Forward test",
  backtest: "Backtest",
};

export const BIAS_LABEL: Record<string, string> = { with: "With HTF", against: "Against HTF", neutral: "Neutral" };
export const REGIME_LABEL: Record<string, string> = { range: "Range", trend: "Trend", unclear: "Unclear" };
export const EXIT_LABEL: Record<string, string> = {
  target: "Target",
  stop: "Stop",
  invalidation: "Invalidation",
  manual: "Manual",
  be: "Breakeven",
  time: "Time",
  not_filled: "Not filled",
  open: "Still open",
};
