import { describe, expect, it } from "vitest";
import { makeIdea, makeMistake, makeScenario } from "../../test/fixtures";
import { ideaSchema } from "./validation";
import {
  buildSavePayload,
  editorMistakeCost,
  emptyScenario,
  errorField,
  inlineMessage,
  isObservationOnly,
  newEditorIdea,
  parseCost,
  patchScenario,
  priceFieldId,
  pricesReady,
  SYMBOL_FIELD_ID,
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
    expect(buildSavePayload(i)).toEqual({ ok: false, error: "Alternative #2 · Stop: required", field: priceFieldId(alt2.key, "stop") });
    const p = idea({ scenarios: [{ ...idea().scenarios[0], stop: "" }] });
    expect(buildSavePayload(p)).toMatchObject({ error: "Primary · Stop: required" });
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

describe("newEditorIdea defaults", () => {
  it("uses the default risk %, or blank when none is given", () => {
    expect(newEditorIdea({ riskPct: 0.5 }).riskPct).toBe("0.5");
    expect(newEditorIdea({}).riskPct).toBe("");
  });
});

describe("toEditorIdea", () => {
  it("maps tags, attachments, links and costs; primary first", () => {
    const alt = makeScenario({ id: 20, isPrimary: false, typeName: "BE stop", scenarioTypeId: 3 });
    const prim = makeScenario({ id: 30, isPrimary: true, target: 130, r: 1 });
    const v = makeIdea({
      id: 5,
      scenarios: [alt, prim],
      tags: [{ id: 7, name: "Naked", group: "Level", color: "#000" }],
      attachments: [{ id: 9, ideaId: 5, filePath: "a.png", caption: "c", kind: "before", createdAt: "" }],
      mistakes: [
        makeMistake({ id: 1, costR: 0.5, scenarioId: 20 }),
        makeMistake({ id: 2, costR: null, scenarioId: 999 }), // link to a scenario that no longer exists
        makeMistake({ id: 3, costR: null, scenarioId: null }),
      ],
      riskPct: 1,
      pnlUsd: null,
    });
    const e = toEditorIdea(v);
    expect(e.scenarios.map((s) => s.id)).toEqual([30, 20]);
    expect(e.scenarios[0].target).toBe("130");
    expect(e.tagIds).toEqual([7]);
    expect(e.riskPct).toBe("1");
    expect(e.pnlUsd).toBe("");
    expect(e.attachments).toMatchObject([{ id: 9, filePath: "a.png", caption: "c", kind: "before" }]);
    expect(e.mistakes.map((m) => [m.costR, m.scenarioKey === e.scenarios[1].key ? "alt" : m.scenarioKey])).toEqual([["0.5", "alt"], ["", null], ["", null]]);
  });
  it("tolerates a null checklist state", () => {
    const v = makeIdea({ checklistState: null as unknown as Record<string, boolean> });
    expect(toEditorIdea(v).checklistState).toEqual({});
  });
});

describe("observation and scenario removal", () => {
  it("toObservation clears an auto close time (keeps a typed one) and unlinks mistakes", () => {
    const i = idea({ closedAt: OPENED, closedAtAuto: true, mistakes: [mistake({ scenarioKey: "x" })] });
    const o = toObservation(i);
    expect(o.scenarios).toEqual([]);
    expect(o.closedAt).toBeNull();
    expect(o.mistakes[0].scenarioKey).toBeNull();
    expect(toObservation({ ...i, closedAtAuto: false }).closedAt).toBe(OPENED);
  });
  it("removeScenario unlinks only the mistakes that pointed at it", () => {
    const i = idea({ scenarios: [...idea().scenarios, { ...emptyScenario(false), key: "alt1" }, { ...emptyScenario(false), key: "alt2" }], mistakes: [mistake({ key: "a", scenarioKey: "alt1" }), mistake({ key: "b", scenarioKey: "alt2" })] });
    const next = removeScenario(i, "alt1");
    expect(next.scenarios.map((s) => s.key)).not.toContain("alt1");
    expect(next.mistakes.map((m) => m.scenarioKey)).toEqual([null, "alt2"]);
  });
});

describe("editorMistakeCost without a measurable alternative", () => {
  it("is null when the alternative has no usable prices, or there is no primary", () => {
    const alt = { ...emptyScenario(false), key: "alt", entry: "", stop: "" };
    const i = idea({ scenarios: [...idea().scenarios, alt] });
    expect(editorMistakeCost(i, mistake({ scenarioKey: "alt" }))).toBeNull();
    const noPrimary = { ...i, scenarios: [{ ...alt, entry: "100", stop: "90", exitPrice: "110" }] };
    expect(editorMistakeCost(noPrimary, mistake({ scenarioKey: "alt" }))).toBeNull();
  });
});

describe("buildSavePayload details", () => {
  it("maps a not-filled exit to no price, a bare exit price to a manual exit, and links mistakes by position", () => {
    const base = idea();
    const alt = { ...emptyScenario(false), key: "alt", entry: "100", stop: "90", exitPrice: "105", exitReason: "" as const };
    const i = idea({
      scenarios: [{ ...base.scenarios[0], exitPrice: "120", exitReason: "not_filled" }, alt],
      attachments: [{ key: "k1", id: 4, filePath: "a.png", caption: "c", kind: "after" }],
      mistakes: [mistake({ scenarioKey: "alt", costR: "1,5" }), mistake({ key: "m2", scenarioKey: "gone" }), mistake({ key: "m3" })],
    });
    const r = buildSavePayload(i);
    if (!r.ok) throw new Error(r.error);
    const p = r.payload as { scenarios: { exitPrice: number | null; exitReason: string | null }[]; attachments: unknown[]; mistakes: { scenarioIndex: number | null; costR: number | null }[] };
    expect(p.scenarios[0]).toMatchObject({ exitPrice: null, exitReason: "not_filled" });
    expect(p.scenarios[1]).toMatchObject({ exitPrice: 105, exitReason: "manual" });
    expect(p.attachments).toEqual([{ id: 4, filePath: "a.png", caption: "c", kind: "after" }]);
    expect(p.mistakes.map((m) => m.scenarioIndex)).toEqual([1, null, null]);
    expect(p.mistakes[0].costR).toBe(1.5);
  });
  it("rejects unparsable target or exit text and names the alternative", () => {
    const base = idea();
    const bad = (patch: object) => buildSavePayload(idea({ scenarios: [{ ...base.scenarios[0], ...patch }] }));
    expect(bad({ target: "abc" })).toMatchObject({ ok: false, error: "Primary · Target: must be a number" });
    expect(bad({ exitPrice: "abc" })).toMatchObject({ ok: false, error: "Primary · Exit: must be a number" });
    // text in the exit price is tolerated when the trade was never filled (the price is dropped)
    expect(bad({ exitPrice: "abc", exitReason: "not_filled" }).ok).toBe(true);
    const withAlt = idea({ scenarios: [base.scenarios[0], { ...emptyScenario(false), entry: "1" }] });
    expect(buildSavePayload(withAlt)).toMatchObject({ ok: false, error: "Alternative #1 · Stop: required" });
  });
});

describe("every non-empty price box must parse (no silent drop)", () => {
  const base = idea();
  const key = base.scenarios[0].key;
  const bad = (patch: object, over: Partial<EditorIdea> = {}) => buildSavePayload(idea({ ...over, scenarios: [{ ...base.scenarios[0], ...patch }] }));
  it.each([
    ["entry", { entry: "abc" }, "Primary · Entry: must be a number"],
    ["stop", { stop: "1.2.3" }, "Primary · Stop: must be a number"],
    ["target", { target: "x" }, "Primary · Target: must be a number"],
    ["exit", { exitPrice: "abc" }, "Primary · Exit: must be a number"],
  ] as const)("blocks an unparseable %s and names the field to focus", (field, patch, error) => {
    expect(bad(patch)).toEqual({ ok: false, error, field: priceFieldId(key, field) });
  });
  it("labels alternatives by their number", () => {
    const alt = { ...emptyScenario(false), entry: "100", stop: "90", target: "x" };
    expect(buildSavePayload(idea({ scenarios: [base.scenarios[0], alt] }))).toEqual({
      ok: false,
      error: "Alternative #1 · Target: must be a number",
      field: priceFieldId(alt.key, "target"),
    });
  });
  it("an empty required box says it is required", () => {
    expect(bad({ entry: "  " })).toMatchObject({ error: "Primary · Entry: required", field: priceFieldId(key, "entry") });
  });
  it("an exit typed before choosing Not filled is ignored, as before", () => {
    expect(bad({ exitPrice: "abc", exitReason: "not_filled" }).ok).toBe(true);
  });
  it("a blank coin is 'Pick a coin' and points at the Coin field", () => {
    expect(buildSavePayload(idea({ symbol: "  " }))).toEqual({ ok: false, error: "Pick a coin", field: SYMBOL_FIELD_ID });
  });
});

describe("forward test left on the Prices tab", () => {
  it("empty entry or stop says how to get a price-less result", () => {
    const base = idea({ status: "forward_test", outcome: "hit" });
    const r = buildSavePayload({ ...base, scenarios: [{ ...base.scenarios[0], entry: "", stop: "" }] });
    expect(r).toEqual({ ok: false, error: "Add entry and stop, or switch to Hit / Miss (no prices)", field: priceFieldId(base.scenarios[0].key, "entry") });
  });
  it("pricesReady needs the primary's entry and stop", () => {
    const base = idea({ status: "forward_test" });
    expect(pricesReady(base)).toBe(true);
    expect(pricesReady({ scenarios: [{ ...base.scenarios[0], stop: " " }] })).toBe(false);
    expect(pricesReady({ scenarios: [] })).toBe(false);
  });
});

describe("errorField / inlineMessage", () => {
  const scenarios = [
    { key: "p", isPrimary: true },
    { key: "a1", isPrimary: false },
    { key: "a2", isPrimary: false },
  ];
  it("maps a save error to the DOM id of its field", () => {
    expect(errorField("Pick a coin", scenarios)).toBe(SYMBOL_FIELD_ID);
    expect(errorField("Coin: too long", scenarios)).toBe(SYMBOL_FIELD_ID);
    expect(errorField("Opened: Invalid date", scenarios)).toBe("idea-opened");
    expect(errorField("Closed: Close time is before open time", scenarios)).toBe("idea-closed");
    expect(errorField("Primary · Exit: must be a number", scenarios)).toBe(priceFieldId("p", "exit"));
    expect(errorField("Alternative #2 · Stop: must be below entry for a long", scenarios)).toBe(priceFieldId("a2", "stop"));
  });
  it("is undefined for errors that are not about one field", () => {
    expect(errorField("Mark the observation as Hit or Miss", scenarios)).toBeUndefined();
    expect(errorField("Alternative #9 · Stop: nope", scenarios)).toBeUndefined();
    expect(errorField("Primary · Exit reason: pick one", scenarios)).toBeUndefined();
  });
  it("keeps only the part that fits under the field", () => {
    expect(inlineMessage("Primary · Exit: must be a number")).toBe("must be a number");
    expect(inlineMessage("Closed: Close time is before open time")).toBe("Close time is before open time");
    expect(inlineMessage("Pick a coin")).toBe("Pick a coin");
    expect(inlineMessage("Skip reason: x: y")).toBe("Skip reason: x: y");
  });
});

describe("toEditorIdea ordering", () => {
  it("orders two alternatives by id after the primary", () => {
    const v = makeIdea({ scenarios: [makeScenario({ id: 9 }), makeScenario({ id: 3, isPrimary: true }), makeScenario({ id: 5 })] });
    expect(toEditorIdea(v).scenarios.map((s) => s.id)).toEqual([3, 5, 9]);
  });
});
