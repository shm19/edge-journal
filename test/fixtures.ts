import type { IdeaStatus, Setup, Tag } from "@/db/schema";
import type { IdeaView, MistakeView, ScenarioView } from "@/lib/queries";
import { outcomeOf } from "@/lib/stats";

let seq = 0;

/** A scenario with entry 100 and 1R = 10 price units; `r` null means still open. */
export function makeScenario(o: Partial<ScenarioView> & { r?: number | null; dir?: "long" | "short" } = {}): ScenarioView {
  const { r = null, dir = "long", ...rest } = o;
  const sign = dir === "long" ? 1 : -1;
  const id = rest.id ?? ++seq;
  return {
    id,
    ideaId: 1,
    scenarioTypeId: null,
    isPrimary: false,
    entry: 100,
    stop: 100 - sign * 10,
    target: null,
    exitPrice: r == null ? null : 100 + sign * 10 * r,
    exitReason: r == null ? null : "manual",
    notes: "",
    typeName: null,
    r,
    rr: null,
    outcome: outcomeOf(r, 0.1),
    ...rest,
  };
}

export function makeMistake(o: Partial<MistakeView> = {}): MistakeView {
  return { id: ++seq, mistakeTypeId: 1, name: "Early TP", note: "", costR: null, scenarioId: null, linkedName: null, cost: null, ...o };
}

export function makeSetup(o: Partial<Setup> = {}): Setup {
  return {
    id: 1,
    name: "LHPB",
    description: "",
    rules: "",
    checklist: [],
    status: "live",
    defaultTimeframe: null,
    color: "#6366f1",
    createdAt: "",
    updatedAt: "",
    ...o,
  };
}

export function makeTag(o: Partial<Tag> = {}): Tag {
  return { id: ++seq, name: "Naked", group: "Level", color: "#000000", ...o };
}

/**
 * Build an IdeaView without a DB. `r` is the primary scenario's R (null = open primary, `false` = no scenarios at all).
 * `date` is the default openedAt; the stats date is `closedAt ?? openedAt`, as in loadIdeas.
 */
export function makeIdea(
  o: Partial<Omit<IdeaView, "primary">> & { r?: number | null | false; date?: string; status?: IdeaStatus } = {},
): IdeaView {
  const { r = 1, date = "2026-09-10T10:00:00.000Z", ...rest } = o;
  const id = rest.id ?? ++seq;
  const primary = r === false ? null : makeScenario({ isPrimary: true, r, ideaId: id, dir: rest.direction ?? "long" });
  const scenarios = rest.scenarios ?? (primary ? [primary] : []);
  const openedAt = rest.openedAt ?? date;
  return {
    id,
    symbol: "BTC",
    direction: "long",
    status: "taken",
    setupId: null,
    entryTimeframe: null,
    htfBias: null,
    regime: null,
    openedAt,
    closedAt: null,
    thesis: "",
    invalidation: "",
    skipReason: "",
    review: "",
    followedPlan: null,
    riskPct: null,
    feesUsd: null,
    pnlUsd: null,
    checklistState: {},
    confidence: null,
    outcome: null,
    createdAt: "",
    updatedAt: "",
    setup: null,
    tags: [],
    primary: scenarios.find((s) => s.isPrimary) ?? primary,
    attachments: [],
    mistakes: [],
    ...rest,
    scenarios,
    date: rest.closedAt ?? openedAt,
  };
}
