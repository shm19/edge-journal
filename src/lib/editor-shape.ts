// Shared (server + client) shape of the idea editor's form state.
import type { IdeaView } from "./queries";

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

let seq = 0;
const key = (prefix: string) => `${prefix}${++seq}`;
const str = (v: number | null | undefined) => (v == null ? "" : String(v));

export function emptyScenario(primary: boolean, typeId: number | null = null): EditorScenario {
  return {
    key: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
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
