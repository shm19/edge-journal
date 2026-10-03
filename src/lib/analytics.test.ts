import { describe, expect, it } from "vitest";
import { makeIdea, makeMistake, makeScenario, makeSetup, makeTag } from "../../test/fixtures";
import {
  applyFilters,
  DIMENSIONS,
  dimensionKeys,
  isDimension,
  NO_TAG,
  mistakeSummary,
  observationStats,
  parseFilters,
  primaryPoints,
  rrBucket,
  scenarioComparisons,
  tagGroupNames,
} from "./analytics";

const keys = (dim: string, idea = makeIdea()) => dimensionKeys(dim)(primaryPoints([idea])[0] ?? { id: 1, r: 0, date: idea.date, idea });

describe("parseFilters", () => {
  it("parses known values and ignores junk", () => {
    const f = parseFilters({ status: "taken,backtest,bogus,toString,constructor", setup: "3", tag: "-1", symbol: "BTC", open: "1", dir: ["long", "short"] });
    expect(f.status).toEqual(["taken", "backtest"]);
    expect(f.setupId).toBe(3);
    expect(f.tagId).toBeUndefined();
    expect(f.symbol).toBe("BTC");
    expect(f.open).toBe(true);
    expect(f.direction).toBe("long");
  });
  it("keeps only real dates, orders an inverted range and drops junk", () => {
    expect(parseFilters({ from: "2026-10-01", to: "2026-10-05" })).toMatchObject({ from: "2026-10-01", to: "2026-10-05" });
    expect(parseFilters({ from: "2026-10-09", to: "2026-10-01" })).toMatchObject({ from: "2026-10-01", to: "2026-10-09" });
    expect(parseFilters({ from: "2026-02-30", to: "nope" })).toMatchObject({ from: undefined, to: undefined });
    expect(parseFilters({ from: "junk", to: "2026-10-05" })).toMatchObject({ from: undefined, to: "2026-10-05" });
    expect(parseFilters({ to: ["2026-1-5", "x"] }).to).toBe("2026-01-05");
    expect(parseFilters({}).from).toBeUndefined();
  });
  it("leaves status undefined when absent", () => {
    expect(parseFilters({}).status).toBeUndefined();
    expect(parseFilters({}).open).toBe(false);
  });
});

describe("applyFilters", () => {
  const tag = makeTag({ id: 50, name: "Naked" });
  const list = [
    makeIdea({ id: 1, symbol: "BTC", status: "taken", direction: "long", setupId: 1, setup: makeSetup({ id: 1, name: "LHPB" }), tags: [tag], entryTimeframe: "1h", htfBias: "with", openedAt: "2026-09-01T23:59:59.000Z", thesis: "Weekly open reclaim" }),
    makeIdea({ id: 2, symbol: "ETH", status: "skipped", direction: "short", setupId: 2, entryTimeframe: "4h", htfBias: "against", openedAt: "2026-09-02T00:00:00.000Z", skipReason: "News risk" }),
    makeIdea({ id: 3, symbol: "BTC", status: "taken", r: null, openedAt: "2026-09-03T12:00:00.000Z" }),
    makeIdea({ id: 4, symbol: "BTC", status: "backtest", r: null, openedAt: "2026-09-04T12:00:00.000Z" }),
    makeIdea({ id: 5, symbol: "BTC", status: "forward_test", r: false, outcome: "hit", openedAt: "2026-09-05T12:00:00.000Z" }),
  ];
  const ids = (f: Parameters<typeof applyFilters>[1]) => applyFilters(list, f).map((i) => i.id);

  it("returns everything with no filters", () => expect(ids({})).toEqual([1, 2, 3, 4, 5]));
  it("status", () => expect(ids({ status: ["taken", "skipped"] })).toEqual([1, 2, 3]));
  it("setup", () => expect(ids({ setupId: 2 })).toEqual([2]));
  it("symbol", () => expect(ids({ symbol: "ETH" })).toEqual([2]));
  it("tag", () => expect(ids({ tagId: 50 })).toEqual([1]));
  it("timeframe", () => expect(ids({ timeframe: "4h" })).toEqual([2]));
  it("bias", () => expect(ids({ bias: "against" })).toEqual([2]));
  it("direction", () => expect(ids({ direction: "short" })).toEqual([2]));
  it("open: primary without a result, not hit/miss observations", () => expect(ids({ open: true })).toEqual([3, 4]));
  it("open + status=taken matches what the dashboard counts", () => expect(ids({ status: ["taken"], open: true })).toEqual([3]));
  it("date bounds are inclusive UTC days", () => {
    expect(ids({ from: "2026-09-02" })).toEqual([2, 3, 4, 5]);
    expect(ids({ to: "2026-09-01" })).toEqual([1]); // 23:59:59Z is still Sep 1
    expect(ids({ from: "2026-09-02", to: "2026-09-02" })).toEqual([2]); // 00:00:00Z is Sep 2
  });
  it("search covers symbol, thesis, skip reason, setup and tags, case-insensitively", () => {
    expect(ids({ q: "weekly open" })).toEqual([1]);
    expect(ids({ q: "news" })).toEqual([2]);
    expect(ids({ q: "lhpb" })).toEqual([1]);
    expect(ids({ q: "naked" })).toEqual([1]);
    expect(ids({ q: "eth" })).toEqual([2]);
    expect(ids({ q: "nothing-like-this" })).toEqual([]);
  });
  it("combines filters with AND", () => expect(ids({ symbol: "BTC", status: ["taken"], direction: "long", open: true })).toEqual([3]));
});

describe("rrBucket", () => {
  it("buckets at the boundaries", () => {
    expect(rrBucket(null)).toBe("No target");
    expect(rrBucket(undefined)).toBe("No target");
    expect(rrBucket(0.99)).toBe("< 1");
    expect(rrBucket(1)).toBe("1 – 1.5");
    expect(rrBucket(1.49)).toBe("1 – 1.5");
    expect(rrBucket(1.5)).toBe("1.5 – 2");
    expect(rrBucket(2)).toBe("2 – 3");
    expect(rrBucket(2.99)).toBe("2 – 3");
    expect(rrBucket(3)).toBe("3+");
  });
});

describe("dimensionKeys", () => {
  it("every dimension in DIMENSIONS is handled (none falls through to setup by accident)", () => {
    const idea = makeIdea({ setup: null });
    for (const d of DIMENSIONS.filter((x) => x.key !== "setup")) {
      expect(keys(d.key, idea), d.key).not.toEqual(["No setup"]);
    }
  });
  it("setup", () => {
    expect(keys("setup")).toEqual(["No setup"]);
    expect(keys("setup", makeIdea({ setup: makeSetup({ name: "LHPB" }) }))).toEqual(["LHPB"]);
    expect(keys("unknown-dim")).toEqual(["No setup"]);
  });
  it("tag and tag group", () => {
    const idea = makeIdea({ tags: [makeTag({ name: "Naked", group: "Level" }), makeTag({ name: "Hammer", group: "Candle" })] });
    expect(keys("tag", idea)).toEqual(["Naked", "Hammer"]);
    expect(keys("group:Level", idea)).toEqual(["Naked"]);
    // An idea with nothing in the group lands in "No tag", not in a group literally called "—".
    expect(keys("group:Missing", idea)).toEqual([NO_TAG]);
    expect(keys("tag")).toEqual([NO_TAG]);
  });
  it("mistake", () => {
    expect(keys("mistake")).toEqual(["No mistake"]);
    expect(keys("mistake", makeIdea({ mistakes: [makeMistake({ name: "FOMO" }), makeMistake({ name: "Early TP" })] }))).toEqual(["FOMO", "Early TP"]);
  });
  it("symbol, timeframe, direction, status", () => {
    expect(keys("symbol", makeIdea({ symbol: "ETH" }))).toEqual(["ETH"]);
    expect(keys("timeframe")).toEqual(["—"]);
    expect(keys("timeframe", makeIdea({ entryTimeframe: "1h" }))).toEqual(["1h"]);
    expect(keys("direction")).toEqual(["Long"]);
    expect(keys("direction", makeIdea({ direction: "short" }))).toEqual(["Short"]);
    expect(keys("status", makeIdea({ status: "forward_test" }))).toEqual(["Forward test"]);
  });
  it("bias and regime", () => {
    expect(keys("bias")).toEqual(["—"]);
    expect(keys("bias", makeIdea({ htfBias: "against" }))).toEqual(["Against HTF"]);
    expect(keys("regime")).toEqual(["—"]);
    expect(keys("regime", makeIdea({ regime: "trend" }))).toEqual(["Trend"]);
  });
  it("session, weekday, month use UTC", () => {
    // 2026-09-10 is a Thursday; 14:00Z is inside both London and New York hours in September (BST/EDT).
    const idea = makeIdea({ openedAt: "2026-09-10T14:00:00.000Z", date: "2026-09-10T14:00:00.000Z" });
    expect(keys("session", idea)).toEqual(["London/NY overlap"]);
    expect(keys("weekday", idea)).toEqual(["Thu"]);
    expect(keys("month", idea)).toEqual(["2026-09"]);
    // month uses the stats date (close), weekday the open date
    const closed = makeIdea({ openedAt: "2026-08-31T23:00:00.000Z", closedAt: "2026-09-01T01:00:00.000Z" });
    expect(keys("month", closed)).toEqual(["2026-09"]);
    expect(keys("weekday", closed)).toEqual(["Mon"]);
  });
  it("followedPlan", () => {
    expect(keys("followedPlan")).toEqual(["—"]);
    expect(keys("followedPlan", makeIdea({ followedPlan: true }))).toEqual(["Yes"]);
    expect(keys("followedPlan", makeIdea({ followedPlan: false }))).toEqual(["No"]);
  });
  it("exitReason and plannedRR read the primary", () => {
    expect(keys("exitReason")).toEqual(["Manual"]);
    expect(keys("exitReason", makeIdea({ r: false }))).toEqual(["—"]);
    const withRR = makeIdea({ scenarios: [makeScenario({ isPrimary: true, r: 1, rr: 2.5 })] });
    expect(keys("plannedRR", withRR)).toEqual(["2 – 3"]);
    expect(keys("plannedRR")).toEqual(["No target"]);
  });
  it("confidence", () => {
    expect(keys("confidence")).toEqual(["—"]);
    expect(keys("confidence", makeIdea({ confidence: 4 }))).toEqual(["4/5"]);
  });
  it("checklist buckets", () => {
    const setup = makeSetup({ checklist: ["a", "b", "c", "d"] });
    const bucket = (state: Record<string, boolean>) => keys("checklist", makeIdea({ setup, checklistState: state }))[0];
    expect(keys("checklist")).toEqual(["No checklist"]);
    expect(bucket({ a: true, b: true, c: true, d: true })).toBe("All checked");
    expect(bucket({ a: true, b: true })).toBe("Half or more");
    expect(bucket({ a: true })).toBe("Less than half");
    expect(bucket({})).toBe("Less than half");
  });
  it("isDimension accepts built-ins and existing tag groups only", () => {
    expect(isDimension("setup", [])).toBe(true);
    expect(isDimension("group:Level", ["Level"])).toBe(true);
    expect(isDimension("group:Nope", ["Level"])).toBe(false);
    expect(isDimension("bogus", [])).toBe(false);
  });
});

describe("scenarioComparisons", () => {
  it("compares primary with each typed alternative where both are closed", () => {
    const a = makeScenario({ r: 3, typeName: "BE stop" });
    const b = makeScenario({ r: 0, typeName: "BE stop" });
    const list = [
      makeIdea({ id: 1, scenarios: [makeScenario({ isPrimary: true, r: 1 }), a] }),
      makeIdea({ id: 2, scenarios: [makeScenario({ isPrimary: true, r: -1 }), b] }),
      makeIdea({ id: 3, scenarios: [makeScenario({ isPrimary: true, r: null }), makeScenario({ r: 2, typeName: "BE stop" })] }), // open primary: skipped
      makeIdea({ id: 4, scenarios: [makeScenario({ isPrimary: true, r: 1 }), makeScenario({ r: null, typeName: "BE stop" })] }), // open alternative: skipped
      makeIdea({ id: 5, scenarios: [makeScenario({ isPrimary: true, r: 1 }), makeScenario({ r: 1 })] }), // untyped
    ];
    const rows = scenarioComparisons(list, 0.1);
    const be = rows.find((r) => r.name === "BE stop")!;
    expect(be.pairs).toBe(2);
    expect(rows.find((r) => r.name === "Untyped alternative")!.pairs).toBe(1);
    expect(rows[0].name).toBe("BE stop"); // sorted by pairs desc
  });
  it("returns nothing without alternatives", () => expect(scenarioComparisons([makeIdea()], 0.1)).toEqual([]));
});

describe("observationStats", () => {
  it("counts hits and misses among ideas with an outcome", () => {
    const list = [makeIdea({ outcome: "hit" }), makeIdea({ outcome: "hit" }), makeIdea({ outcome: "miss" }), makeIdea({})];
    expect(observationStats(list)).toEqual({ count: 3, hits: 2, misses: 1, hitRate: 2 / 3 });
  });
  it("hitRate is null with no observations", () => expect(observationStats([makeIdea()]).hitRate).toBeNull());
});

describe("mistakeSummary", () => {
  it("sums each type's own costs, counts, and reports how many were measured", () => {
    const list = [
      makeIdea({ mistakes: [makeMistake({ name: "FOMO", cost: 1.5 }), makeMistake({ name: "Early TP", cost: -0.5 })] }),
      makeIdea({ mistakes: [makeMistake({ name: "FOMO", cost: null })] }),
      makeIdea({ mistakes: [makeMistake({ name: "FOMO", cost: 0.5 })] }),
    ];
    const rows = mistakeSummary(list);
    expect(rows.map((r) => r.name)).toEqual(["FOMO", "Early TP"]); // costliest first
    expect(rows[0]).toEqual({ name: "FOMO", count: 3, costKnown: 2, cost: 2 });
    expect(rows[1]).toEqual({ name: "Early TP", count: 1, costKnown: 1, cost: -0.5 });
  });
  it("a negative total (mistake saved R) sorts last and keeps its sign", () => {
    const rows = mistakeSummary([makeIdea({ mistakes: [makeMistake({ name: "A", cost: -2 }), makeMistake({ name: "B", cost: 0.1 })] })]);
    expect(rows.map((r) => r.cost)).toEqual([0.1, -2]);
  });
  it("overlap: two mistakes on the same alternative each show the full delta per type", () => {
    const rows = mistakeSummary([
      makeIdea({ mistakes: [makeMistake({ name: "A", scenarioId: 9, cost: 2 }), makeMistake({ name: "B", scenarioId: 9, cost: 2 })] }),
    ]);
    expect(rows.map((r) => r.cost)).toEqual([2, 2]);
  });
  it("all-unknown costs give costKnown 0", () => {
    expect(mistakeSummary([makeIdea({ mistakes: [makeMistake({ name: "A" })] })])[0]).toMatchObject({ count: 1, costKnown: 0, cost: 0 });
  });
});

describe("tagGroupNames", () => {
  it("is unique and sorted", () => expect(tagGroupNames([{ group: "b" }, { group: "a" }, { group: "b" }])).toEqual(["a", "b"]));
});
