// Pure: URL params of the balance simulator (Analytics → Balance, dashboard card). Unit tested in balance.test.ts.
import { parsePrice } from "./price";
import type { BalanceMode, SimOptions } from "./stats";

export interface BalanceInputs {
  start: number;
  /** PERCENT of the account per trade (1 = 1%). */
  riskPct: number;
  mode: BalanceMode;
  useTradeRisk: boolean;
  fee: number;
}

export type BalanceField = "start" | "risk" | "mode" | "fee";
export type BalanceErrors = Partial<Record<BalanceField, string>>;

/** URL param names: start, risk (%), mode, trade (1 = use each trade's recorded risk), fee ($). */
export const BALANCE_KEYS = ["start", "risk", "mode", "trade", "fee"] as const;
/** Params that belong to the view, not to the idea filters (kept by the filter bar's Clear). */
export const VIEW_KEYS = ["group", "metric", "tab", ...BALANCE_KEYS] as const;

export const BALANCE_DEFAULT_START = 1000;
export const MAX_START = 1e12;
export const MAX_FEE = 1e9;

type Sp = Record<string, string | string[] | undefined>;

/**
 * Validate the inputs. A param that is absent takes its default (risk: the Settings default); a param that is present
 * but invalid is an error, never silently replaced. Numbers go through `parsePrice` ("1,000", "1.234,5"; "0x10" is
 * rejected). A Settings default risk that is not > 0 is treated as 1%. On error `inputs` still holds the defaults for the bad fields.
 */
export function parseBalanceParams(sp: Sp, defaultRiskPct: number): { inputs: BalanceInputs; errors: BalanceErrors } {
  const get = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const errors: BalanceErrors = {};
  const defaultRisk = defaultRiskPct > 0 ? defaultRiskPct : 1;
  const num = (k: BalanceField, fallback: number, ok: (n: number) => boolean, msg: string, emptyIsDefault = false) => {
    const raw = get(k);
    if (raw === undefined || (emptyIsDefault && raw.trim() === "")) return fallback;
    const n = parsePrice(raw);
    if (n == null || !ok(n)) {
      errors[k] = msg;
      return fallback;
    }
    return n;
  };
  const start = num("start", BALANCE_DEFAULT_START, (n) => n > 0 && n <= MAX_START, "Starting balance must be more than 0");
  const riskPct = num("risk", defaultRisk, (n) => n > 0 && n <= 100, "Risk must be more than 0 and at most 100 (percent, 1 = 1%)");
  const fee = num("fee", 0, (n) => n >= 0 && n <= MAX_FEE, "Fee must be 0 or more", true);
  const modeRaw = get("mode");
  let mode: BalanceMode = "compounding";
  if (modeRaw === "fixed" || modeRaw === "compounding") mode = modeRaw;
  else if (modeRaw !== undefined) errors.mode = "Mode must be compounding or fixed";
  return { inputs: { start, riskPct, mode, useTradeRisk: get("trade") === "1", fee }, errors };
}

/** Query string (no leading "?") for the given inputs, omitting nothing so a link is self-describing. */
export function balanceQuery(i: BalanceInputs): string {
  const p = new URLSearchParams({ start: String(i.start), risk: String(i.riskPct), mode: i.mode, fee: String(i.fee) });
  if (i.useTradeRisk) p.set("trade", "1");
  return p.toString();
}

/** The one mapping from the form's inputs to the simulation options (`fee` is `feePerTrade`). */
export function simOptions(i: BalanceInputs): SimOptions {
  return { start: i.start, riskPct: i.riskPct, mode: i.mode, useTradeRisk: i.useTradeRisk, feePerTrade: i.fee };
}
