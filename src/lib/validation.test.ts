import { describe, expect, it } from "vitest";
import { z } from "zod";
import { firstError, ideaSchema } from "./validation";

const scen = (o: Record<string, unknown> = {}) => ({
  scenarioTypeId: null,
  isPrimary: true,
  entry: 100,
  stop: 90,
  target: 130,
  exitPrice: 120,
  exitReason: "target",
  notes: "",
  ...o,
});
const idea = (o: Record<string, unknown> = {}) => ({
  symbol: "btc",
  direction: "long",
  status: "taken",
  setupId: null,
  entryTimeframe: null,
  htfBias: null,
  regime: null,
  openedAt: "2026-09-01T10:00:00.000Z",
  closedAt: "2026-09-01T12:00:00.000Z",
  followedPlan: null,
  riskPct: null,
  feesUsd: null,
  pnlUsd: null,
  confidence: null,
  scenarios: [scen()],
  ...o,
});

function fail(input: unknown) {
  const r = ideaSchema.safeParse(input);
  expect(r.success).toBe(false);
  return r.success ? "" : firstError(r.error, input);
}

describe("ideaSchema accepts", () => {
  it("a valid long and short", () => {
    expect(ideaSchema.safeParse(idea()).success).toBe(true);
    expect(ideaSchema.safeParse(idea({ direction: "short", scenarios: [scen({ entry: 100, stop: 110, target: 70, exitPrice: 80 })] })).success).toBe(true);
  });
  it("an open trade with no exit and no target", () => {
    expect(ideaSchema.safeParse(idea({ closedAt: null, scenarios: [scen({ target: null, exitPrice: null, exitReason: null })] })).success).toBe(true);
  });
  it("an observation-only forward test with an outcome", () => {
    const r = ideaSchema.safeParse(idea({ status: "forward_test", outcome: "hit", scenarios: [], closedAt: null }));
    expect(r.success).toBe(true);
  });
});

describe("ideaSchema superRefine rules", () => {
  it("stop on the wrong side (long and short)", () => {
    expect(fail(idea({ scenarios: [scen({ stop: 110 })] }))).toMatch(/below entry for a long/);
    expect(fail(idea({ direction: "short", scenarios: [scen({ stop: 90, target: 70, exitPrice: 80 })] }))).toMatch(/above entry for a short/);
  });
  it("stop equal to entry", () => {
    expect(fail(idea({ scenarios: [scen({ stop: 100 })] }))).toMatch(/^Primary · Stop: can't equal entry/);
  });
  it("skipped / missed need a reason", () => {
    expect(fail(idea({ status: "skipped", skipReason: "  " }))).toMatch(/why you skipped/);
    expect(fail(idea({ status: "missed" }))).toMatch(/why you skipped/);
    expect(ideaSchema.safeParse(idea({ status: "skipped", skipReason: "news" })).success).toBe(true);
  });
  it("observation-only forward test needs an outcome", () => {
    expect(fail(idea({ status: "forward_test", scenarios: [], closedAt: null }))).toMatch(/Hit or Miss/);
  });
  it("outcome only for forward tests", () => {
    expect(fail(idea({ outcome: "hit" }))).toMatch(/only for forward tests/);
  });
  it("exactly one primary scenario unless observation-only", () => {
    expect(fail(idea({ scenarios: [] }))).toMatch(/primary scenario/);
    expect(fail(idea({ scenarios: [scen(), scen()] }))).toMatch(/primary scenario/);
    expect(fail(idea({ scenarios: [scen({ isPrimary: false })] }))).toMatch(/primary scenario/);
  });
  it("closed before opened", () => {
    expect(fail(idea({ closedAt: "2026-08-01T00:00:00.000Z" }))).toMatch(/before open/);
  });
  it("a mistake can't be measured against the primary or a missing scenario", () => {
    const m = (i: number) => ({ mistakeTypeId: 1, note: "", costR: null, scenarioIndex: i });
    expect(fail(idea({ mistakes: [m(0)] }))).toMatch(/only be measured against an alternative/);
    expect(fail(idea({ mistakes: [m(5)] }))).toMatch(/only be measured against an alternative/);
    const alt = scen({ isPrimary: false, stop: 85 });
    expect(ideaSchema.safeParse(idea({ scenarios: [scen(), alt], mistakes: [m(1)] })).success).toBe(true);
  });
  it("not_filled forces the exit price to null", () => {
    const r = ideaSchema.safeParse(idea({ scenarios: [scen({ exitReason: "not_filled", exitPrice: 120 })] }));
    expect(r.success && r.data.scenarios[0].exitPrice).toBeNull();
  });
  it("an exit price needs an exit reason", () => {
    expect(fail(idea({ scenarios: [scen({ exitReason: null })] }))).toMatch(/Exit reason: Pick an exit reason/);
  });
  it("target must be on the profit side", () => {
    expect(fail(idea({ scenarios: [scen({ target: 95, exitPrice: null, exitReason: null })] }))).toMatch(/above entry for a long/);
    expect(fail(idea({ scenarios: [scen({ target: 100, exitPrice: null, exitReason: null })] }))).toMatch(/^Primary · Target: must be above entry for a long$/);
    expect(fail(idea({ direction: "short", scenarios: [scen({ stop: 110, target: 105, exitPrice: null, exitReason: null })] }))).toMatch(/below entry for a short/);
  });
});

describe("firstError", () => {
  it("labels by isPrimary, not by index", () => {
    const input = idea({ scenarios: [scen({ isPrimary: false, stop: 120 }), scen()] });
    expect(fail(input)).toMatch(/^Alternative #1 · Stop:/);
    const input2 = idea({ scenarios: [scen(), scen({ isPrimary: false }), scen({ isPrimary: false, stop: 120 })] });
    expect(fail(input2)).toMatch(/^Alternative #2 · Stop:/);
    expect(fail(idea({ scenarios: [scen({ stop: 120 })] }))).toMatch(/^Primary · Stop:/);
  });
  it("labels plain fields and rewrites type errors", () => {
    expect(fail(idea({ symbol: "" }))).toBe("Coin: Coin is required");
    expect(fail(idea({ riskPct: "x" }))).toMatch(/^riskPct: /);
    expect(fail(idea({ scenarios: [scen({ entry: "x" })] }))).toBe("Primary · Entry: must be a number");
  });
});

describe("firstError fallbacks", () => {
  it("says 'Invalid input' for an error without issues", () => {
    expect(firstError(new z.ZodError([]))).toBe("Invalid input");
  });
  it("labels scenarios by position when no input is given, and keeps unlabelled fields bare", () => {
    const issue = (path: (string | number)[], message = "bad") => new z.ZodError([{ code: "custom", path, message }]);
    expect(firstError(issue(["scenarios", 0, "entry"]))).toBe("Primary · Entry: bad");
    expect(firstError(issue(["scenarios", 2, "stop"]))).toBe("Alternative #1 · Stop: bad");
    expect(firstError(issue(["scenarios", 1]), { scenarios: [{ isPrimary: true }, { isPrimary: false }] })).toBe("bad");
    expect(firstError(issue(["scenarios", 1, "stop"]), { scenarios: [{ isPrimary: true }, { isPrimary: false }] })).toBe("Alternative #1 · Stop: bad");
    expect(firstError(issue(["scenarios", 0, "weird"]))).toBe("Primary · weird: bad");
    expect(firstError(issue(["skipReason"]))).toBe("bad");
    expect(firstError(issue([]))).toBe("bad");
  });
});
