import { z } from "zod";
import {
  ATTACHMENT_KINDS,
  BIASES,
  DIRECTIONS,
  EXIT_REASONS,
  IDEA_STATUSES,
  OUTCOMES,
  REGIMES,
  SETUP_STATUSES,
} from "@/db/schema";
import { stopIsValid } from "./stats";

const price = z.number().finite().positive();
const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Invalid date");
const text = (max = 20000) => z.string().max(max).default("");

export const scenarioSchema = z.object({
  id: z.number().int().positive().optional(),
  scenarioTypeId: z.number().int().positive().nullable(),
  isPrimary: z.boolean(),
  entry: price,
  stop: price,
  target: price.nullable(),
  exitPrice: price.nullable(),
  exitReason: z.enum(EXIT_REASONS).nullable(),
  notes: text(5000),
}).transform((s) => (s.exitReason === "not_filled" ? { ...s, exitPrice: null } : s)); // never entered → no exit price

export const mistakeInputSchema = z.object({
  mistakeTypeId: z.number().int().positive(),
  note: text(2000),
  costR: z.number().finite().min(-100).max(100).nullable(),
  /** Index into `scenarios` of the alternative this mistake is measured against. */
  scenarioIndex: z.number().int().min(0).nullable(),
});

export const attachmentInputSchema = z.object({
  id: z.number().int().positive().optional(),
  filePath: z.string().regex(/^[a-zA-Z0-9_-]+\.(png|jpe?g|webp|gif)$/),
  caption: text(500),
  kind: z.enum(ATTACHMENT_KINDS),
});

export const ideaSchema = z
  .object({
    id: z.number().int().positive().optional(),
    symbol: z
      .string()
      .trim()
      .min(1, "Pick a coin")
      .max(24)
      .transform((s) => s.toUpperCase()),
    direction: z.enum(DIRECTIONS),
    status: z.enum(IDEA_STATUSES),
    setupId: z.number().int().positive().nullable(),
    entryTimeframe: z.string().max(10).nullable(),
    htfBias: z.enum(BIASES).nullable(),
    regime: z.enum(REGIMES).nullable(),
    openedAt: isoDate,
    closedAt: isoDate.nullable(),
    thesis: text(),
    invalidation: text(),
    skipReason: text(),
    review: text(),
    followedPlan: z.boolean().nullable(),
    riskPct: z.number().finite().min(0).max(100).nullable(),
    feesUsd: z.number().finite().nullable(),
    pnlUsd: z.number().finite().nullable(),
    checklistState: z.record(z.string(), z.boolean()).default({}),
    confidence: z.number().int().min(1).max(5).nullable(),
    outcome: z.enum(OUTCOMES).nullable().default(null),
    tagIds: z.array(z.number().int().positive()).default([]),
    scenarios: z.array(scenarioSchema),
    attachments: z.array(attachmentInputSchema).default([]),
    mistakes: z.array(mistakeInputSchema).max(30).default([]),
  })
  .superRefine((v, ctx) => {
    const observationOnly = v.status === "forward_test" && v.scenarios.length === 0;
    if (observationOnly && !v.outcome) {
      ctx.addIssue({ code: "custom", path: ["outcome"], message: "Mark the observation as Hit or Miss (or add prices)" });
    }
    if (v.outcome && v.status !== "forward_test") {
      ctx.addIssue({ code: "custom", path: ["outcome"], message: "Hit / Miss is only for forward tests" });
    }
    const primaries = v.scenarios.filter((s) => s.isPrimary).length;
    if (!observationOnly && primaries !== 1) {
      ctx.addIssue({ code: "custom", path: ["scenarios"], message: "Add entry and stop for the primary scenario" });
    }
    v.scenarios.forEach((s, i) => {
      if (!stopIsValid(v.direction, s.entry, s.stop)) {
        ctx.addIssue({
          code: "custom",
          path: ["scenarios", i, "stop"],
          message:
            s.stop === s.entry
              ? "can't equal entry — keep the initial stop (it defines 1R) and use the Breakeven exit instead"
              : `must be ${v.direction === "long" ? "below" : "above"} entry for a ${v.direction}`,
        });
      }
    });
    v.scenarios.forEach((s, i) => {
      if (s.exitPrice != null && !s.exitReason) {
        ctx.addIssue({ code: "custom", path: ["scenarios", i, "exitReason"], message: "Pick an exit reason for the exit price" });
      }
      if (s.target != null && (v.direction === "long" ? s.target <= s.entry : s.target >= s.entry)) {
        ctx.addIssue({
          code: "custom",
          path: ["scenarios", i, "target"],
          message: `must be ${v.direction === "long" ? "above" : "below"} entry for a ${v.direction}`,
        });
      }
    });
    if ((v.status === "skipped" || v.status === "missed") && !v.skipReason.trim()) {
      ctx.addIssue({ code: "custom", path: ["skipReason"], message: "Say why you skipped / missed it" });
    }
    v.mistakes.forEach((m, i) => {
      if (m.scenarioIndex != null && (!v.scenarios[m.scenarioIndex] || v.scenarios[m.scenarioIndex].isPrimary)) {
        ctx.addIssue({ code: "custom", path: ["mistakes", i, "scenarioIndex"], message: "A mistake can only be measured against an alternative" });
      }
    });
    if (v.closedAt && Date.parse(v.closedAt) < Date.parse(v.openedAt)) {
      ctx.addIssue({ code: "custom", path: ["closedAt"], message: "Close time is before open time" });
    }
  });

export type IdeaInput = z.input<typeof ideaSchema>;

export const setupSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(80),
  description: text(5000),
  rules: text(),
  checklist: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
  status: z.enum(SETUP_STATUSES),
  defaultTimeframe: z.string().max(10).nullable(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export type SetupInput = z.input<typeof setupSchema>;

export const tagSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(60),
  group: z.string().trim().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export const scenarioTypeSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(60),
  description: text(500),
});

export const settingsSchema = z.object({
  beThresholdR: z.number().min(0).max(1),
  minRR: z.number().min(0).max(20),
  defaultRiskPct: z.number().min(0).max(100),
  symbols: z.array(z.string().trim().min(1).max(24)).max(100),
});

const FIELD_LABELS: Record<string, string> = {
  symbol: "Coin",
  entry: "Entry",
  stop: "Stop",
  target: "Target",
  exitPrice: "Exit",
  exitReason: "Exit reason",
  openedAt: "Opened",
  closedAt: "Closed",
  skipReason: "Skip reason",
  beThresholdR: "Breakeven band",
  minRR: "Minimum R:R",
  defaultRiskPct: "Default risk %",
  name: "Name",
  group: "Group",
};

/**
 * Human-readable first validation error, e.g. "Alternative #1 · Stop: …".
 * Pass the original input so scenarios are labelled by `isPrimary` instead of by position.
 */
export function firstError(err: z.ZodError, input?: unknown): string {
  const issue = err.issues[0];
  if (!issue) return "Invalid input";
  const path = issue.path;
  let where = "";
  if (path[0] === "scenarios" && typeof path[1] === "number") {
    const list = ((input as { scenarios?: { isPrimary?: boolean }[] } | null)?.scenarios ?? []) as { isPrimary?: boolean }[];
    const i = path[1];
    const primary = list.length ? list[i]?.isPrimary === true : i === 0;
    where = primary ? "Primary" : `Alternative #${list.slice(0, i).filter((x) => !x?.isPrimary).length + 1}`;
    if (path[2]) where += ` · ${FIELD_LABELS[String(path[2])] ?? String(path[2])}`;
  } else if (path.length) {
    where = FIELD_LABELS[String(path[path.length - 1])] ?? String(path[path.length - 1]);
  }
  const msg = /expected number/.test(issue.message) ? "must be a number" : issue.message;
  const labelled = path[0] === "scenarios" ? path.length > 2 : !["outcome", "skipReason", "symbol"].includes(String(path[0]));
  return where && labelled ? `${where}: ${msg}` : msg;
}
