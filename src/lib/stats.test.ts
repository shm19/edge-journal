import { describe, expect, it } from "vitest";
import {
  compareScenarios,
  equityCurve,
  groupSummaries,
  mistakeCost,
  outcomeOf,
  plannedRR,
  simulateBalance,
  type SimPoint,
  realizedR,
  sampleConfidence,
  sessionOf,
  skipAudit,
  stopIsValid,
  summarize,
  tradeMistakeCost,
} from "./stats";

describe("R math", () => {
  it("computes long R", () => {
    expect(realizedR("long", 100, 90, 120)).toBe(2);
    expect(realizedR("long", 100, 90, 90)).toBe(-1);
    expect(realizedR("long", 100, 90, 95)).toBe(-0.5);
  });

  it("computes short R", () => {
    expect(realizedR("short", 100, 110, 80)).toBe(2);
    expect(realizedR("short", 100, 110, 110)).toBe(-1);
  });

  it("returns null when open or zero risk", () => {
    expect(realizedR("long", 100, 90, null)).toBeNull();
    expect(realizedR("long", 100, 100, 120)).toBeNull();
  });

  it("computes planned RR to target", () => {
    expect(plannedRR("long", 100, 90, 125)).toBe(2.5);
    expect(plannedRR("short", 2000, 2050, 1900)).toBe(2);
    expect(plannedRR("long", 100, 90, null)).toBeNull();
  });

  it("validates stop side", () => {
    expect(stopIsValid("long", 100, 90)).toBe(true);
    expect(stopIsValid("long", 100, 110)).toBe(false);
    expect(stopIsValid("short", 100, 110)).toBe(true);
  });

  it("classifies outcome with BE threshold", () => {
    expect(outcomeOf(0.05, 0.1)).toBe("be");
    expect(outcomeOf(-0.1, 0.1)).toBe("be");
    expect(outcomeOf(0.5, 0.1)).toBe("win");
    expect(outcomeOf(-1, 0.1)).toBe("loss");
    expect(outcomeOf(null, 0.1)).toBe("open");
  });
});

const pts = (rs: number[]) => rs.map((r, i) => ({ id: i + 1, r, date: `2026-09-${String(i + 1).padStart(2, "0")}` }));

describe("summarize", () => {
  it("handles empty input", () => {
    const s = summarize([]);
    expect(s.count).toBe(0);
    expect(s.winRate).toBeNull();
    expect(s.expectancy).toBeNull();
    expect(s.totalR).toBeNull(); // empty renders "—", never 0
    expect(summarize(pts([0])).totalR).toBe(0); // a real zero total stays 0
  });

  it("computes core metrics", () => {
    const s = summarize(pts([2, -1, -1, 3, 0.05, -1]));
    expect(s.count).toBe(6);
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(3);
    expect(s.breakevens).toBe(1);
    expect(s.winRate).toBeCloseTo(2 / 6);
    expect(s.totalR).toBeCloseTo(2.05);
    expect(s.expectancy).toBeCloseTo(2.05 / 6);
    expect(s.avgWin).toBeCloseTo(2.5);
    expect(s.avgLoss).toBeCloseTo(-1);
    expect(s.profitFactor).toBeCloseTo(5 / 3);
    expect(s.best).toBe(3);
    expect(s.worst).toBe(-1);
  });

  it("computes drawdown and streaks in date order", () => {
    // cumulative: 1, 0, -1, -2, 1 → peak 1, trough -2 → DD 3
    const s = summarize(pts([1, -1, -1, -1, 3]));
    expect(s.maxDrawdown).toBeCloseTo(3);
    expect(s.longestLossStreak).toBe(3);
    expect(s.longestWinStreak).toBe(1);
  });

  it("sorts by date before streaks", () => {
    const s = summarize([
      { id: 1, r: -1, date: "2026-09-03" },
      { id: 2, r: 1, date: "2026-09-01" },
      { id: 3, r: -1, date: "2026-09-02" },
    ]);
    expect(s.longestLossStreak).toBe(2);
  });

  it("profit factor is null with no losses", () => {
    expect(summarize(pts([1, 2])).profitFactor).toBeNull();
  });

  it("tracks plan adherence ignoring unknowns", () => {
    const s = summarize([
      { id: 1, r: 1, date: "a", followedPlan: true },
      { id: 2, r: -1, date: "b", followedPlan: false },
      { id: 3, r: -1, date: "c", followedPlan: null },
    ]);
    expect(s.followedPlanPct).toBeCloseTo(0.5);
  });
});

describe("equity + grouping", () => {
  it("builds a cumulative curve", () => {
    expect(equityCurve(pts([1, -1, 2])).map((p) => p.cum)).toEqual([1, 0, 2]);
  });

  it("places multi-key points in every group", () => {
    const data = pts([1, -1, 2]).map((p, i) => ({ ...p, tags: [["a"], ["a", "b"], []][i] }));
    const g = groupSummaries(data, (p) => p.tags);
    const byKey = Object.fromEntries(g.map((x) => [x.key, x.summary.count]));
    expect(byKey).toEqual({ a: 2, b: 1, "—": 1 });
  });
});

describe("scenario comparison + skip audit", () => {
  it("diffs variant vs primary", () => {
    const c = compareScenarios([
      { ideaId: 1, date: "a", primaryR: -1, variantR: 0 },
      { ideaId: 2, date: "b", primaryR: 2, variantR: 0 },
    ]);
    expect(c.pairs).toBe(2);
    expect(c.deltaTotalR).toBe(-1);
    expect(c.variantBetterCount).toBe(1);
  });

  it("audits skipped ideas", () => {
    const a = skipAudit(pts([2, -1, -1]));
    expect(a.leftOnTable).toBe(2);
    expect(a.lossesAvoided).toBe(2);
    expect(a.net).toBe(0);
  });
});

describe("misc", () => {
  it("rates sample size", () => {
    expect(sampleConfidence(0)).toBe("none");
    expect(sampleConfidence(10)).toBe("low");
    expect(sampleConfidence(30)).toBe("early");
    expect(sampleConfidence(80)).toBe("solid");
  });

  it("maps UTC hour to session", () => {
    expect(sessionOf("2026-09-23T03:00:00Z")).toBe("Asia");
    expect(sessionOf("2026-09-23T09:00:00Z")).toBe("London");
    expect(sessionOf("2026-09-23T14:00:00Z")).toBe("London/NY overlap");
    expect(sessionOf("2026-09-23T18:00:00Z")).toBe("New York");
    expect(sessionOf("2026-09-23T22:00:00Z")).toBe("After hours");
  });
});

describe("review fixes", () => {
  it("counts not-filled scenarios as 0R", async () => {
    const { scenarioR } = await import("./stats");
    expect(scenarioR("long", { entry: 100, stop: 90, exitPrice: null, exitReason: "not_filled" })).toBe(0);
    expect(scenarioR("long", { entry: 100, stop: 90, exitPrice: 120, exitReason: "target" })).toBe(2);
  });

  it("counts a point once per group even if keys repeat", () => {
    const g = groupSummaries([{ id: 1, r: 3, date: "a" }], () => ["dup", "dup"]);
    expect(g).toHaveLength(1);
    expect(g[0].summary.totalR).toBe(3);
  });

  it("uses DST-aware sessions", () => {
    // US open 09:30 New York = 13:30 UTC in summer, 14:30 UTC in winter — both in the overlap.
    expect(sessionOf("2026-07-01T13:30:00Z")).toBe("London/NY overlap");
    expect(sessionOf("2026-12-01T14:30:00Z")).toBe("London/NY overlap");
    // 07:30 UTC in winter is London (07:30 GMT), in summer London too (08:30 BST).
    expect(sessionOf("2026-12-01T07:30:00Z")).toBe("London");
  });
});

describe("mistakeCost", () => {
  const sc = (exitPrice: number | null, exitReason: string | null = "manual") => ({ entry: 100, stop: 90, exitPrice, exitReason });

  it("is alternative R minus primary R: positive when the mistake lost R", () => {
    expect(mistakeCost("long", sc(130), sc(110))).toBe(2); // +3R alternative vs +1R actual: lost 2R
  });
  it("is negative when the actual trade did better than the alternative (the mistake saved R)", () => {
    expect(mistakeCost("long", sc(95), sc(110))).toBe(-1.5);
  });
  it("works for shorts", () => {
    const s = (exitPrice: number) => ({ entry: 100, stop: 110, exitPrice, exitReason: "manual" });
    expect(mistakeCost("short", s(80), s(90))).toBe(1);
  });
  it("is null when unlinked or the primary is missing", () => {
    expect(mistakeCost("long", undefined, sc(110))).toBeNull();
    expect(mistakeCost("long", sc(130), undefined)).toBeNull();
  });
  it("is null while the primary or the alternative is open", () => {
    expect(mistakeCost("long", sc(130), sc(null))).toBeNull();
    expect(mistakeCost("long", sc(null), sc(110))).toBeNull();
  });
  it("is null when risk is zero", () => {
    expect(mistakeCost("long", { entry: 100, stop: 100, exitPrice: 120, exitReason: "manual" }, sc(110))).toBeNull();
  });
  it("treats not-filled as 0R", () => {
    expect(mistakeCost("long", sc(null, "not_filled"), sc(90))).toBe(1);
  });
});

describe("tradeMistakeCost", () => {
  const m = (cost: number | null, scenarioId: number | null = null, costR: number | null = null) => ({ cost, scenarioId, costR });

  it("is null when no cost is known", () => {
    expect(tradeMistakeCost([])).toBeNull();
    expect(tradeMistakeCost([m(null), m(null, 4)])).toBeNull();
  });
  it("adds independent manual costs", () => {
    expect(tradeMistakeCost([m(1, null, 1), m(0.5, null, 0.5)])).toBe(1.5);
  });
  it("counts a shared alternative's delta once", () => {
    expect(tradeMistakeCost([m(2, 7), m(2, 7)])).toBe(2);
    expect(tradeMistakeCost([m(2, 7), m(1, 8)])).toBe(3);
  });
  it("still adds a manual cost on top of a linked delta, even on the same alternative", () => {
    expect(tradeMistakeCost([m(2, 7), m(0.5, 7, 0.5)])).toBe(2.5);
  });
  it("ignores unmeasured mistakes but keeps the measured ones, and keeps negative totals", () => {
    expect(tradeMistakeCost([m(null, 7), m(-1, 8)])).toBe(-1);
  });
});

describe("plannedRR guards", () => {
  it("is null for a missing/non-finite target or zero risk, and signed per direction", () => {
    expect(plannedRR("long", 100, 90, null)).toBeNull();
    expect(plannedRR("long", 100, 90, Number.NaN)).toBeNull();
    expect(plannedRR("long", 100, 100, 120)).toBeNull();
    expect(plannedRR("long", 100, 90, 130)).toBe(3);
    expect(plannedRR("short", 100, 110, 70)).toBe(3);
  });
});

describe("compareScenarios with nothing to compare", () => {
  it("returns zero pairs and unknown (null) deltas", () => {
    const c = compareScenarios([]);
    expect(c.pairs).toBe(0);
    expect(c.deltaTotalR).toBe(0);
    expect(c.deltaExpectancy).toBeNull();
    expect(c.deltaWinRate).toBeNull();
    expect(c.variantBetterCount).toBe(0);
  });
});

describe("simulateBalance", () => {
  const pt = (id: number, r: number, riskPct?: number | null): SimPoint => ({ id, r, date: `2026-01-0${id}T00:00:00.000Z`, riskPct });
  const known = [pt(1, 2), pt(2, -1), pt(3, 3)];
  const base = { start: 1000, riskPct: 1, mode: "compounding" as const, useTradeRisk: false };

  it("compounding: +2R, -1R, +3R at 1% on $1,000 -> 1020, 1009.80, 1040.094", () => {
    const s = simulateBalance(known, base);
    expect(s.trades.map((t) => t.balance)).toEqual([expect.closeTo(1020, 9), expect.closeTo(1009.8, 9), expect.closeTo(1040.094, 9)]);
    expect(s.end).toBeCloseTo(1040.094, 9);
    expect(s.pnl).toBeCloseTo(40.094, 9);
    expect(s.returnPct).toBeCloseTo(4.0094, 9);
    expect(s.start).toBe(1000);
  });

  it("fixed: 1020, 1010, 1040 (always risks 1% of the starting balance)", () => {
    const s = simulateBalance(known, { ...base, mode: "fixed" });
    expect(s.trades.map((t) => t.balance)).toEqual([1020, 1010, 1040]);
    expect(s.trades.map((t) => t.pnl)).toEqual([20, -10, 30]);
    expect(s.largestWin).toBe(30);
    expect(s.largestLoss).toBe(-10);
  });

  it("orders by close date, not input order", () => {
    const s = simulateBalance([known[2], known[0], known[1]], { ...base, mode: "fixed" });
    expect(s.trades.map((t) => t.id)).toEqual([1, 2, 3]);
  });

  it("drawdown is peak to trough in $ and in % of the peak", () => {
    const s = simulateBalance([pt(1, 2), pt(2, -1), pt(3, -1)], { ...base, mode: "fixed" });
    expect(s.maxDrawdown).toBe(20); // 1020 -> 1000
    expect(s.maxDrawdownPct).toBeCloseTo((20 / 1020) * 100, 9);
  });

  it("a losing streak compounds down more slowly than it fixes", () => {
    const losses = [pt(1, -1), pt(2, -1), pt(3, -1)];
    const c = simulateBalance(losses, base);
    const f = simulateBalance(losses, { ...base, mode: "fixed" });
    expect(c.end).toBeCloseTo(1000 * 0.99 ** 3, 9);
    expect(f.end).toBe(970);
    expect(c.largestWin).toBeNull();
    expect(c.maxDrawdown).toBeCloseTo(1000 - c.end, 9);
    expect(c.ruined).toBe(false);
  });

  it("zero trades: end equals start, null return, no extremes", () => {
    const s = simulateBalance([], base);
    expect(s).toMatchObject({ end: 1000, pnl: 0, returnPct: null, maxDrawdown: 0, maxDrawdownPct: 0, largestWin: null, largestLoss: null, ruined: false, skippedAfterRuin: 0 });
    expect(s.trades).toEqual([]);
  });

  it("ruin: the balance is clamped to 0, the loss is only what was left, and later trades are not simulated", () => {
    const s = simulateBalance([pt(1, -1), pt(2, 5), pt(3, 5)], { start: 1000, riskPct: 100, mode: "compounding", useTradeRisk: false });
    expect(s.ruined).toBe(true);
    expect(s.trades).toHaveLength(1);
    expect(s.end).toBe(0);
    expect(s.pnl).toBe(-1000);
    expect(s.largestLoss).toBe(-1000);
    expect(s.skippedAfterRuin).toBe(2);
    expect(s.returnPct).toBe(-100);
    expect(s.maxDrawdownPct).toBe(100);
  });

  it("ruin also happens in fixed mode once the losses exceed the balance", () => {
    const s = simulateBalance([pt(1, -1), pt(2, -1), pt(3, 1)], { start: 100, riskPct: 60, mode: "fixed", useTradeRisk: false });
    expect(s.trades.map((t) => t.balance)).toEqual([40, 0]);
    expect(s.trades[1].pnl).toBe(-40);
    expect(s.ruined).toBe(true);
    expect(s.skippedAfterRuin).toBe(1);
  });

  it("per-trade risk: uses each trade's own %, falls back to the default and counts the fallbacks", () => {
    const s = simulateBalance([pt(1, 1, 2), pt(2, 1, null), pt(3, 1)], { ...base, mode: "fixed", useTradeRisk: true });
    expect(s.trades.map((t) => [t.riskPct, t.fallback, t.pnl])).toEqual([
      [2, false, 20],
      [1, true, 10],
      [1, true, 10],
    ]);
    expect(s.fallbackCount).toBe(2);
  });

  it("a recorded risk of 0 counts as missing (fallback), not as a free trade", () => {
    const s = simulateBalance([pt(1, 1, 0), pt(2, 1, -2)], { ...base, mode: "fixed", useTradeRisk: true });
    expect(s.trades.map((t) => [t.riskPct, t.fallback, t.pnl])).toEqual([[1, true, 10], [1, true, 10]]);
    expect(s.fallbackCount).toBe(2);
  });

  it("float dust left after a wipe-out still counts as ruin and clamps to exactly 0", () => {
    const s = simulateBalance(Array.from({ length: 11 }, (_, i) => pt(i + 1, -1)), { start: 0.3, riskPct: 10, mode: "fixed", useTradeRisk: false });
    expect(s.ruined).toBe(true);
    expect(s.end).toBe(0);
    expect(s.trades).toHaveLength(10);
    expect(s.skippedAfterRuin).toBe(1);
  });

  it("without useTradeRisk the recorded risk is ignored and nothing counts as a fallback", () => {
    const s = simulateBalance([pt(1, 1, 5)], { ...base, mode: "fixed" });
    expect(s.trades[0]).toMatchObject({ riskPct: 1, fallback: false, pnl: 10 });
    expect(s.fallbackCount).toBe(0);
  });

  it("risk is a percent, not a fraction: 1 means 1%", () => {
    expect(simulateBalance([pt(1, 1)], { ...base, riskPct: 0.5, mode: "fixed" }).end).toBe(1005);
  });

  it("fees come off every trade, including breakevens, and can turn a small win into a loss", () => {
    const s = simulateBalance([pt(1, 0), pt(2, 0.05)], { ...base, mode: "fixed", feePerTrade: 2 });
    expect(s.trades.map((t) => t.pnl)).toEqual([-2, expect.closeTo(-1.5, 9)]);
    expect(s.largestWin).toBeNull();
    expect(s.end).toBeCloseTo(996.5, 9);
  });

  it("does no rounding (that is for display)", () => {
    expect(simulateBalance([pt(1, 1)], { ...base, start: 333.33 }).end).toBe(333.33 + 333.33 * 0.01);
  });
});
