import { describe, expect, it } from "vitest";
import { makeIdea, makeMistake, makeScenario } from "../../test/fixtures";
import { ideaSchema } from "./validation";
import {
  buildSavePayload,
  editorMistakeCost,
  emptyScenario,
  isObservationOnly,
  newEditorIdea,
  parseCost,
  patchScenario,
  removeScenario,
  setClosedAt,
  setOpenedAt,
  setStatus,
  toEditorIdea,
  toObservation,
  toPriceMode,
  type EditorIdea,
  type EditorMistake,
} from "./editor-shape";

const OPENED = "2026-09-10T10:00:00.000Z";

/** A long with entry 100, stop 90 (1R = 10), primary + one "Hold" alternative. */
function idea(over: Partial<EditorIdea> = {}): EditorIdea {
  const base = newEditorIdea({ symbol: "BTC" });
  const primary = { ...base.scenarios[0], entry: "100", stop: "90" };
  return { ...base, openedAt: OPENED, scenarios: [primary], ...over };
}
const primaryKey = (i: EditorIdea) => i.scenarios.find((s) => s.isPrimary)!.key;
const mistake = (o: Partial<EditorMistake> = {}): EditorMistake => ({ key: "m1", mistakeTypeId: 1, note: "", costR: "", scenarioKey: null, ...o });

describe("closedAt is never stamped with 'now'", () => {
  it("defaults a blank closedAt to openedAt (flagged as automatic) when an exit price is entered", () => {
    const i = idea();
    const next = patchScenario(i, primaryKey(i), { exitPrice: "110" });
    expect(next.closedAt).toBe(OPENED);
    expect(next.closedAtAuto).toBe(true);
  });
  it("does the same for a not-filled exit", () => {
    const i = idea();
    expect(patchScenario(i, primaryKey(i), { exitReason: "not_filled" }).closedAt).toBe(OPENED);
  });
  it("keeps a closedAt the user already set", () => {
    const i = idea({ closedAt: "2026-09-12T08:00:00.000Z" });
    const next = patchScenario(i, primaryKey(i), { exitPrice: "110" });
    expect(next.closedAt).toBe("2026-09-12T08:00:00.000Z");
    expect(next.closedAtAuto).toBeFalsy();
  });
  it("does not touch closedAt for alternatives or non-exit edits", () => {
    const i = idea({ scenarios: [...idea().scenarios, emptyScenario(false)] });
    const alt = i.scenarios.find((s) => !s.isPrimary)!;
    expect(patchScenario(i, alt.key, { exitPrice: "105" }).closedAt).toBeNull();
    expect(patchScenario(i, primaryKey(i), { notes: "x" }).closedAt).toBeNull();
  });
  it("'Still open' clears an auto-set closedAt but not a typed one", () => {
    const i = idea();
    const closed = patchScenario(i, primaryKey(i), { exitPrice: "110", exitReason: "target" });
    const reopened = patchScenario(closed, primaryKey(i), { exitPrice: "", exitReason: "" });
    expect(reopened.closedAt).toBeNull();
    expect(reopened.closedAtAuto).toBe(false);

    const typed = setClosedAt(closed, "2026-09-11T00:00:00.000Z");
    expect(patchScenario(typed, primaryKey(i), { exitPrice: "", exitReason: "" }).closedAt).toBe("2026-09-11T00:00:00.000Z");
  });
  it("an auto close time follows the open time", () => {
    const i = idea();
    const closed = patchScenario(i, primaryKey(i), { exitPrice: "110" });
    const moved = setOpenedAt(closed, "2026-09-09T00:00:00.000Z");
    expect(moved.closedAt).toBe("2026-09-09T00:00:00.000Z");
    expect(setOpenedAt(setClosedAt(closed, "2026-09-12T00:00:00.000Z"), "2026-09-09T00:00:00.000Z").closedAt).toBe("2026-09-12T00:00:00.000Z");
  });
});

describe("observation mode is derived", () => {
  it("a forward test with no scenarios is observation-only; any other status is not", () => {
    expect(isObservationOnly({ status: "forward_test", scenarios: [] })).toBe(true);
    expect(isObservationOnly({ status: "forward_test", scenarios: idea().scenarios })).toBe(false);
    expect(isObservationOnly({ status: "taken", scenarios: [] })).toBe(false);
  });
  it("switching an observation to another status adds an empty primary (no dead end)", () => {
    const obs = toObservation(idea({ status: "forward_test" }));
    expect(isObservationOnly(obs)).toBe(true);
    const taken = setStatus(obs, "taken");
    expect(taken.scenarios).toHaveLength(1);
    expect(taken.scenarios[0].isPrimary).toBe(true);
    expect(isObservationOnly(taken)).toBe(false);
  });
  it("keeps existing scenarios on a status change and does not add one for forward_test", () => {
    const i = idea();
    expect(setStatus(i, "skipped").scenarios).toBe(i.scenarios);
    expect(setStatus(toObservation(i), "forward_test").scenarios).toHaveLength(0);
  });
  it("toPriceMode adds a primary once", () => {
    const obs = toObservation(idea());
    expect(toPriceMode(toPriceMode(obs)).scenarios).toHaveLength(1);
  });
  it("toObservation drops scenarios and unlinks mistakes", () => {
    const alt = emptyScenario(false);
    const i = idea({ scenarios: [...idea().scenarios, alt], mistakes: [mistake({ scenarioKey: alt.key })] });
    const obs = toObservation(i);
    expect(obs.scenarios).toEqual([]);
    expect(obs.mistakes[0].scenarioKey).toBeNull();
  });
});

describe("mistake cost in the editor", () => {
  const alt = { ...emptyScenario(false), entry: "100", stop: "90", exitPrice: "120", exitReason: "target" };
  const withAlt = (o: Partial<EditorIdea> = {}) => {
    const base = idea();
    const primary = { ...base.scenarios[0], exitPrice: "90", exitReason: "stop" }; // -1R
    return { ...base, scenarios: [primary, alt], ...o };
  };
  it("measures alternative R minus primary R", () => {
    const i = withAlt();
    expect(editorMistakeCost(i, mistake({ scenarioKey: alt.key }))).toBe(3); // +2R - (-1R)
  });
  it("a typed cost wins over the link", () => {
    expect(editorMistakeCost(withAlt(), mistake({ scenarioKey: alt.key, costR: "0,5" }))).toBe(0.5);
  });
  it("is null for no link, a link to a scenario that is gone, or an open primary", () => {
    expect(editorMistakeCost(withAlt(), mistake())).toBeNull();
    expect(editorMistakeCost(withAlt(), mistake({ scenarioKey: "gone" }))).toBeNull();
    const open = idea({ scenarios: [idea().scenarios[0], alt] });
    expect(editorMistakeCost(open, mistake({ scenarioKey: alt.key }))).toBeNull();
  });
  it("removing a scenario unlinks the mistakes that pointed at it", () => {
    const i = withAlt({ mistakes: [mistake({ scenarioKey: alt.key })] });
    const next = removeScenario(i, alt.key);
    expect(next.mistakes[0].scenarioKey).toBeNull();
    expect(next.scenarios).toHaveLength(1);
  });
  it("parseCost flags garbage instead of discarding it silently", () => {
    expect(parseCost("")).toEqual({ value: null, invalid: false });
    expect(parseCost("-1,5")).toEqual({ value: -1.5, invalid: false });
    expect(parseCost("-")).toEqual({ value: null, invalid: true });
    expect(parseCost("1.2.3").invalid).toBe(true);
  });
});

describe("buildSavePayload", () => {
  it("parses prices, defaults the exit reason and nulls what does not apply", () => {
    const base = idea({ status: "skipped", skipReason: "why", followedPlan: true, thesis: "t" });
    const i = patchScenario(base, primaryKey(base), { exitPrice: "64,250".replace(",", "") });
    const res = buildSavePayload({ ...i, scenarios: i.scenarios.map((s) => ({ ...s, entry: "60,000", stop: "59000" })) });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const p = res.payload as { scenarios: { entry: number; exitReason: string }[]; followedPlan: unknown; skipReason: string; outcome: unknown };
    expect(p.scenarios[0].entry).toBe(60000);
    expect(p.scenarios[0].exitReason).toBe("manual");
    expect(p.followedPlan).toBeNull(); // only for taken
    expect(p.skipReason).toBe("why");
    expect(p.outcome).toBeNull();
  });
  it("rejects unparseable prices and missing entry/stop", () => {
    const i = idea();
    const bad = { ...i, scenarios: [{ ...i.scenarios[0], target: "abc" }] };
    expect(buildSavePayload(bad)).toMatchObject({ ok: false });
    expect(buildSavePayload({ ...i, scenarios: [{ ...i.scenarios[0], stop: "" }] })).toMatchObject({ ok: false });
  });
  it("requires Hit or Miss for an observation, and sends no scenarios", () => {
    const obs = toObservation(idea({ status: "forward_test" }));
    expect(buildSavePayload(obs)).toEqual({ ok: false, error: "Mark the observation as Hit or Miss" });
    const ok = buildSavePayload({ ...obs, outcome: "hit" });
    expect(ok.ok && ok.payload.scenarios).toEqual([]);
    expect(ok.ok && ok.payload.outcome).toBe("hit");
  });
  it("refuses a non-numeric mistake cost", () => {
    const res = buildSavePayload(idea({ mistakes: [mistake({ costR: "-" })] }));
    expect(res.ok).toBe(false);
  });
  it("links a mistake to its alternative by position, and to nothing when the scenario is gone", () => {
    const alt = { ...emptyScenario(false), entry: "100", stop: "90" };
    const i = idea({ scenarios: [...idea().scenarios, alt], mistakes: [mistake({ scenarioKey: alt.key }), mistake({ key: "m2", scenarioKey: "gone" })] });
    const res = buildSavePayload(i);
    expect(res.ok && (res.payload.mistakes as { scenarioIndex: number | null }[]).map((m) => m.scenarioIndex)).toEqual([1, null]);
  });
});

describe("closedAtAuto baseline", () => {
  it("is always present, so typing then clearing an exit leaves the form identical", () => {
    for (const base of [newEditorIdea({}), toEditorIdea(makeIdea({ r: null })), toEditorIdea(makeIdea({ r: null, status: "forward_test", scenarios: [] }))]) {
      expect(base.closedAtAuto).toBe(false);
      const key = base.scenarios[0]?.key;
      if (!key) continue;
      const typed = patchScenario(base, key, { exitPrice: "110" });
      const cleared = patchScenario(typed, key, { exitPrice: "", exitReason: "" });
      expect(JSON.stringify(cleared)).toBe(JSON.stringify(base));
    }
  });
  it("setClosedAt(null) after typing returns to the baseline shape", () => {
    const base = toEditorIdea(makeIdea({ r: null }));
    expect(JSON.stringify(setClosedAt(setClosedAt(base, "2026-09-11T00:00:00.000Z"), null))).toBe(JSON.stringify(base));
  });
  it("a loaded close time equal to the open time follows Opened; a different one doesn't", () => {
    const same = toEditorIdea(makeIdea({ closedAt: OPENED, openedAt: OPENED }));
    expect(same.closedAtAuto).toBe(true);
    expect(setOpenedAt(same, "2026-09-09T00:00:00.000Z").closedAt).toBe("2026-09-09T00:00:00.000Z");
    const diff = toEditorIdea(makeIdea({ openedAt: OPENED, closedAt: "2026-09-11T00:00:00.000Z" }));
    expect(diff.closedAtAuto).toBe(false);
    expect(toEditorIdea(makeIdea({ openedAt: OPENED, closedAt: null })).closedAtAuto).toBe(false);
  });
});

describe("buildSavePayload numeric side fields", () => {
  it("parses risk, fees and a negative P&L", () => {
    const res = buildSavePayload(idea({ riskPct: "1,5", feesUsd: "2.5", pnlUsd: "-120,5" }));
    expect(res.ok && [res.payload.riskPct, res.payload.feesUsd, res.payload.pnlUsd]).toEqual([1.5, 2.5, -120.5]);
    const empty = buildSavePayload(idea({ riskPct: "", feesUsd: "", pnlUsd: "" }));
    expect(empty.ok && [empty.payload.riskPct, empty.payload.feesUsd, empty.payload.pnlUsd]).toEqual([null, null, null]);
  });
  it("blocks non-numeric input with a labelled error (never sends NaN)", () => {
    expect(buildSavePayload(idea({ pnlUsd: "abc" }))).toEqual({ ok: false, error: "P&L: Not a number" });
    expect(buildSavePayload(idea({ riskPct: "1.2.3" }))).toEqual({ ok: false, error: "Risk %: Not a number" });
    expect(buildSavePayload(idea({ feesUsd: "-" }))).toEqual({ ok: false, error: "Fees: Not a number" });
  });
});

describe("price error labels", () => {
  it("count alternatives by isPrimary, like the server", () => {
    const alt1 = { ...emptyScenario(false), entry: "100", stop: "90" };
    const alt2 = { ...emptyScenario(false), entry: "100", stop: "" };
    const i = idea({ scenarios: [alt1, idea().scenarios[0], alt2] });
    expect(buildSavePayload(i)).toEqual({ ok: false, error: "Alternative #2: entry and stop are required, and every price must be a valid number" });
    const p = idea({ scenarios: [{ ...idea().scenarios[0], stop: "" }] });
    expect(buildSavePayload(p)).toMatchObject({ error: expect.stringMatching(/^Primary: /) });
  });
});

describe("toEditorIdea -> buildSavePayload -> ideaSchema", () => {
  const parse = (v: ReturnType<typeof makeIdea>) => {
    const res = buildSavePayload(toEditorIdea(v));
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.error);
    const r = ideaSchema.safeParse(res.payload);
    expect(r.success, r.success ? "" : JSON.stringify(r.error.issues)).toBe(true);
  };
  const closedPrimary = makeScenario({ isPrimary: true, r: 2, target: 130, exitReason: "target", exitPrice: 120 });
  it("a closed taken trade with an alternative mistake", () => {
    const alt = makeScenario({ r: 3, exitPrice: 130, exitReason: "target" });
    parse(
      makeIdea({
        scenarios: [closedPrimary, alt],
        closedAt: "2026-09-10T12:00:00.000Z",
        riskPct: 1,
        pnlUsd: -20,
        mistakes: [makeMistake({ scenarioId: alt.id, cost: 1 })],
      }),
    );
  });
  it("a skipped idea", () => {
    parse(makeIdea({ status: "skipped", skipReason: "news", r: null }));
  });
  it("a Hit / Miss observation", () => {
    parse(makeIdea({ status: "forward_test", scenarios: [], r: false, outcome: "miss" }));
  });
});
