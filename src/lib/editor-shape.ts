// Shared (server + client) shape of the idea editor's form state.
import { parsePrice } from "./price";
import type { IdeaView } from "./queries";
import { mistakeCost } from "./stats";

export type Dir = "long" | "short";

export interface EditorScenario {
  key: string;
  id?: number;
  scenarioTypeId: number | null;
  isPrimary: boolean;
  entry: string;
  stop: string;
  target: string;
  exitPrice: string;
  exitReason: string;
  notes: string;
}

export interface EditorAttachment {
  key: string;
  id?: number;
  filePath: string;
  caption: string;
  kind: "before" | "during" | "after";
}

export interface EditorMistake {
  key: string;
  mistakeTypeId: number;
  note: string;
  /** Manual cost in R ("" = not set). */
  costR: string;
  /** Key of the alternative scenario this mistake is measured against. */
  scenarioKey: string | null;
}

export interface EditorIdea {
  id?: number;
  symbol: string;
  direction: "long" | "short";
  status: string;
  setupId: number | null;
  entryTimeframe: string;
  htfBias: string;
  regime: string;
  openedAt: string; // ISO
  closedAt: string | null; // ISO
  /** True while `closedAt` was filled in by the editor (copied from openedAt), not typed by the user. */
  closedAtAuto: boolean;
  thesis: string;
  invalidation: string;
  skipReason: string;
  review: string;
  followedPlan: boolean | null;
  riskPct: string;
  feesUsd: string;
  pnlUsd: string;
  checklistState: Record<string, boolean>;
  confidence: number | null;
  outcome: "hit" | "miss" | null;
  tagIds: number[];
  scenarios: EditorScenario[];
  attachments: EditorAttachment[];
  mistakes: EditorMistake[];
}

export const newKey = () => `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

let seq = 0;
const key = (prefix: string) => `${prefix}${++seq}`;
const str = (v: number | null | undefined) => (v == null ? "" : String(v));

export function emptyScenario(primary: boolean, typeId: number | null = null): EditorScenario {
  return {
    key: newKey(),
    scenarioTypeId: typeId,
    isPrimary: primary,
    entry: "",
    stop: "",
    target: "",
    exitPrice: "",
    exitReason: "",
    notes: "",
  };
}

export function newEditorIdea(defaults: {
  setupId?: number | null;
  status?: string;
  symbol?: string;
  timeframe?: string | null;
  riskPct?: number;
}): EditorIdea {
  return {
    symbol: defaults.symbol ?? "",
    direction: "long",
    status: defaults.status ?? "taken",
    setupId: defaults.setupId ?? null,
    entryTimeframe: defaults.timeframe ?? "",
    htfBias: "",
    regime: "",
    openedAt: new Date().toISOString(),
    closedAt: null,
    closedAtAuto: false,
    thesis: "",
    invalidation: "",
    skipReason: "",
    review: "",
    followedPlan: null,
    riskPct: defaults.riskPct != null ? String(defaults.riskPct) : "",
    feesUsd: "",
    pnlUsd: "",
    checklistState: {},
    confidence: null,
    outcome: null,
    tagIds: [],
    scenarios: [emptyScenario(true)],
    attachments: [],
    mistakes: [],
  };
}

export function toEditorIdea(i: IdeaView): EditorIdea {
  const scen = [...i.scenarios].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.id - b.id);
  const scenKeys = new Map(scen.map((s) => [s.id, key("s")]));
  return {
    id: i.id,
    symbol: i.symbol,
    direction: i.direction,
    status: i.status,
    setupId: i.setupId,
    entryTimeframe: i.entryTimeframe ?? "",
    htfBias: i.htfBias ?? "",
    regime: i.regime ?? "",
    openedAt: i.openedAt,
    closedAt: i.closedAt,
    // A close time equal to the open time is almost certainly the editor's default: let Opened drag it along.
    closedAtAuto: i.closedAt != null && i.closedAt === i.openedAt,
    thesis: i.thesis,
    invalidation: i.invalidation,
    skipReason: i.skipReason,
    review: i.review,
    followedPlan: i.followedPlan,
    riskPct: str(i.riskPct),
    feesUsd: str(i.feesUsd),
    pnlUsd: str(i.pnlUsd),
    checklistState: i.checklistState ?? {},
    confidence: i.confidence,
    outcome: i.outcome,
    tagIds: i.tags.map((t) => t.id),
    scenarios: scen.map((s) => ({
      key: scenKeys.get(s.id)!,
      id: s.id,
      scenarioTypeId: s.scenarioTypeId,
      isPrimary: s.isPrimary,
      entry: str(s.entry),
      stop: str(s.stop),
      target: str(s.target),
      exitPrice: str(s.exitPrice),
      exitReason: s.exitReason ?? "",
      notes: s.notes,
    })),
    attachments: i.attachments.map((a) => ({ key: key("a"), id: a.id, filePath: a.filePath, caption: a.caption, kind: a.kind })),
    mistakes: i.mistakes.map((m) => ({
      key: key("m"),
      mistakeTypeId: m.mistakeTypeId,
      note: m.note,
      costR: m.costR == null ? "" : String(m.costR),
      scenarioKey: m.scenarioId != null ? (scenKeys.get(m.scenarioId) ?? null) : null,
    })),
  };
}

// ---------- Pure editor transitions (unit tested in editor-shape.test.ts) ----------

export const hasPrices = (s: EditorScenario) => [s.entry, s.stop, s.target, s.exitPrice].some((v) => v.trim() !== "");

/** A forward test with no scenarios at all is a Hit / Miss observation. Derived, never stored. */
export const isObservationOnly = (p: Pick<EditorIdea, "status" | "scenarios">) => p.status === "forward_test" && p.scenarios.length === 0;

/** Patch one scenario. Entering an exit on the primary defaults a blank close time to the open time (not "now"). */
export function patchScenario(p: EditorIdea, key: string, patch: Partial<EditorScenario>): EditorIdea {
  const scenarios = p.scenarios.map((s) => (s.key === key ? { ...s, ...patch } : s));
  const next = { ...p, scenarios };
  const target = scenarios.find((s) => s.key === key);
  if (!target?.isPrimary || !("exitPrice" in patch || "exitReason" in patch)) return next;
  const closes = target.exitPrice.trim() !== "" || target.exitReason === "not_filled";
  if (closes && !p.closedAt) return { ...next, closedAt: p.openedAt, closedAtAuto: true };
  // "Still open" undoes a close time the editor filled in, but never one the user typed.
  if (!closes && p.closedAtAuto) return { ...next, closedAt: null, closedAtAuto: false };
  return next;
}

export function setClosedAt(p: EditorIdea, iso: string | null): EditorIdea {
  return { ...p, closedAt: iso, closedAtAuto: false };
}

/** Changing the open time drags an editor-filled close time along, so it can't end up before the open time. */
export function setOpenedAt(p: EditorIdea, iso: string): EditorIdea {
  return p.closedAtAuto ? { ...p, openedAt: iso, closedAt: iso } : { ...p, openedAt: iso };
}

/** Leaving the Hit / Miss mode (or the forward-test status) must leave a primary scenario to fill in. */
export const toPriceMode = (p: EditorIdea): EditorIdea =>
  p.scenarios.some((s) => s.isPrimary) ? p : { ...p, scenarios: [emptyScenario(true), ...p.scenarios] };

export function setStatus(p: EditorIdea, status: string): EditorIdea {
  const next = { ...p, status };
  return status === "forward_test" ? next : toPriceMode(next);
}

/** Hit / Miss mode: drops every scenario (and the mistake links that pointed at them). */
export function toObservation(p: EditorIdea): EditorIdea {
  return { ...p, scenarios: [], closedAt: p.closedAtAuto ? null : p.closedAt, mistakes: p.mistakes.map((m) => ({ ...m, scenarioKey: null })) };
}

export function removeScenario(p: EditorIdea, key: string): EditorIdea {
  return {
    ...p,
    scenarios: p.scenarios.filter((x) => x.key !== key),
    mistakes: p.mistakes.map((m) => (m.scenarioKey === key ? { ...m, scenarioKey: null } : m)),
  };
}

/** Manual cost field: empty = not set; anything that is not a number is flagged. */
export function parseCost(raw: string): { value: number | null; invalid: boolean } {
  if (raw.trim() === "") return { value: null, invalid: false };
  const v = Number(raw.trim().replace(",", "."));
  return Number.isFinite(v) ? { value: v, invalid: false } : { value: null, invalid: true };
}

/** Cost of a mistake as the editor shows it: typed cost wins, else measured against its linked alternative (same rule as the server). */
export function editorMistakeCost(p: EditorIdea, m: EditorMistake): number | null {
  const manual = parseCost(m.costR).value;
  if (manual != null) return manual;
  const alt = p.scenarios.find((x) => !x.isPrimary && x.key === m.scenarioKey);
  if (!alt) return null; // link to a scenario that is gone = no link, as on the server
  const prices = (x: EditorScenario) => {
    const entry = parsePrice(x.entry);
    const stop = parsePrice(x.stop);
    return entry == null || stop == null ? null : { entry, stop, exitPrice: parsePrice(x.exitPrice), exitReason: x.exitReason || null };
  };
  const primary = p.scenarios.find((x) => x.isPrimary);
  return mistakeCost(p.direction, prices(alt), primary && prices(primary));
}

/** DOM id of one price box of a scenario (`field` is entry, stop, target or exit): what a failed save focuses. */
export const priceFieldId = (scenarioKey: string, field: PriceField) => `price-${scenarioKey}-${field}`;
export const SYMBOL_FIELD_ID = "idea-symbol";
export type PriceField = "entry" | "stop" | "target" | "exit";

/** The primary has entry and stop typed: only then is a Hit / Miss result next to prices meaningful. */
export const pricesReady = (p: Pick<EditorIdea, "scenarios">) => {
  const primary = p.scenarios.find((s) => s.isPrimary);
  return !!primary && primary.entry.trim() !== "" && primary.stop.trim() !== "";
};

export type SaveResult = { ok: true; payload: Record<string, unknown> } | { ok: false; error: string; /** DOM id of the first invalid field, if there is one. */ field?: string };

const FIELD_LABEL: Record<PriceField, string> = { entry: "Entry", stop: "Stop", target: "Target", exit: "Exit" };
const LABEL_FIELD = Object.fromEntries(Object.entries(FIELD_LABEL).map(([k, v]) => [v, k])) as Record<string, PriceField>;

/**
 * Which field a save error is about, from its text ("Primary · Exit: …", "Alternative #2 · Stop: …", "Pick a coin",
 * "Closed: …"), so the editor can focus it. Undefined when the error is not about one field.
 */
export function errorField(error: string, scenarios: Pick<EditorScenario, "key" | "isPrimary">[]): string | undefined {
  if (/^(Pick a coin|Coin\b)/.test(error)) return SYMBOL_FIELD_ID;
  if (/^Opened\b/.test(error)) return "idea-opened";
  if (/^Closed\b/.test(error)) return "idea-closed";
  const m = /^(?:Primary|Alternative #(\d+)) · (Entry|Stop|Target|Exit):/.exec(error);
  if (!m) return undefined;
  const s = m[1] ? scenarios.filter((x) => !x.isPrimary)[Number(m[1]) - 1] : scenarios.find((x) => x.isPrimary);
  return s ? priceFieldId(s.key, LABEL_FIELD[m[2]]) : undefined;
}

/** The part of a save error that fits under the field itself ("must be a number" for "Primary · Exit: must be a number"). */
export function inlineMessage(error: string): string {
  const i = error.indexOf(": ");
  return i > 0 && /^(Primary|Alternative #\d+) · |^(Opened|Closed|Coin)\b/.test(error) ? error.slice(i + 2) : error;
}

/** Parse the form into the `saveIdea` payload, or say what is wrong (and which field to focus). */
export function buildSavePayload(idea: EditorIdea): SaveResult {
  const isForward = idea.status === "forward_test";
  const scenarios = idea.scenarios;
  if (!idea.symbol.trim()) return { ok: false, error: "Pick a coin", field: SYMBOL_FIELD_ID };
  const parsed = scenarios.map((s) => ({
    id: s.id,
    scenarioTypeId: s.isPrimary ? null : s.scenarioTypeId,
    isPrimary: s.isPrimary,
    entry: parsePrice(s.entry),
    stop: parsePrice(s.stop),
    target: parsePrice(s.target),
    exitPrice: s.exitReason === "not_filled" ? null : parsePrice(s.exitPrice),
    exitReason: (s.exitReason || (parsePrice(s.exitPrice) == null ? null : "manual")) as string | null,
    notes: s.notes,
  }));
  // Every price box that holds text must parse: a typo must never silently become "empty" (an exit typo would reopen a closed trade).
  for (const [i, s] of scenarios.entries()) {
    const who = s.isPrimary ? "Primary" : `Alternative #${scenarios.slice(0, i).filter((x) => !x.isPrimary).length + 1}`;
    const boxes: [PriceField, string, number | null, boolean][] = [
      ["entry", s.entry, parsed[i].entry, true],
      ["stop", s.stop, parsed[i].stop, true],
      ["target", s.target, parsed[i].target, false],
      ["exit", s.exitPrice, parsed[i].exitPrice, false],
    ];
    for (const [field, raw, value, required] of boxes) {
      const id = priceFieldId(s.key, field);
      if (raw.trim() === "") {
        if (!required) continue;
        // A forward test left on the Prices tab: point at the price-less path instead of just complaining.
        if (isForward) return { ok: false, error: "Add entry and stop, or switch to Hit / Miss (no prices)", field: id };
        return { ok: false, error: `${who} · ${FIELD_LABEL[field]}: required`, field: id };
      }
      if (field === "exit" && s.exitReason === "not_filled") continue; // the exit box is disabled and ignored
      if (value == null) return { ok: false, error: `${who} · ${FIELD_LABEL[field]}: must be a number`, field: id };
    }
  }
  if (isObservationOnly(idea) && !idea.outcome) return { ok: false, error: "Mark the observation as Hit or Miss" };
  if (idea.mistakes.some((m) => parseCost(m.costR).invalid)) return { ok: false, error: "A mistake's cost must be a number (or leave it empty)" };
  const risk = parseCost(idea.riskPct);
  const fees = parseCost(idea.feesUsd);
  const pnl = parseCost(idea.pnlUsd);
  for (const [label, c] of [["Risk %", risk], ["Fees", fees], ["P&L", pnl]] as const) {
    if (c.invalid) return { ok: false, error: `${label}: Not a number` };
  }

  return {
    ok: true,
    payload: {
      id: idea.id,
      symbol: idea.symbol,
      direction: idea.direction,
      status: idea.status,
      setupId: idea.setupId,
      entryTimeframe: idea.entryTimeframe || null,
      htfBias: idea.htfBias || null,
      regime: idea.regime || null,
      openedAt: idea.openedAt,
      closedAt: idea.closedAt,
      thesis: idea.thesis,
      invalidation: idea.invalidation,
      skipReason: idea.status === "skipped" || idea.status === "missed" ? idea.skipReason : "",
      review: idea.review,
      followedPlan: idea.status === "taken" ? idea.followedPlan : null,
      riskPct: risk.value,
      feesUsd: fees.value,
      pnlUsd: pnl.value,
      checklistState: idea.checklistState,
      confidence: idea.confidence,
      outcome: isForward ? idea.outcome : null,
      tagIds: idea.tagIds,
      scenarios: parsed,
      attachments: idea.attachments.map(({ key: _k, ...a }) => a),
      mistakes: idea.mistakes.map((m) => {
        const idx = m.scenarioKey ? scenarios.findIndex((x) => x.key === m.scenarioKey) : -1;
        return { mistakeTypeId: m.mistakeTypeId, note: m.note, costR: parseCost(m.costR).value, scenarioIndex: idx >= 0 ? idx : null };
      }),
    },
  };
}
