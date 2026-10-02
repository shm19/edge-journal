import "server-only";
import { db } from "@/db";
import { settings } from "@/db/schema";

export interface AppSettings {
  beThresholdR: number;
  minRR: number;
  defaultRiskPct: number;
  symbols: string[];
}

const DEFAULTS: AppSettings = {
  beThresholdR: 0.1,
  minRR: 1.5,
  defaultRiskPct: 1,
  symbols: ["BTC", "ETH"],
};

export function getSettings(): AppSettings {
  const rows = Object.fromEntries(db.select().from(settings).all().map((r) => [r.key, r.value]));
  const num = (k: string, d: number) => {
    const v = Number(rows[k]);
    return Number.isFinite(v) ? v : d;
  };
  return {
    beThresholdR: num("beThresholdR", DEFAULTS.beThresholdR),
    minRR: num("minRR", DEFAULTS.minRR),
    defaultRiskPct: num("defaultRiskPct", DEFAULTS.defaultRiskPct),
    symbols: rows.symbols
      ? rows.symbols
          .split(",")
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean)
      : DEFAULTS.symbols,
  };
}
