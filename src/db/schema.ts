import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
};

export const SETUP_STATUSES = ["testing", "live", "retired"] as const;
export const IDEA_STATUSES = ["taken", "skipped", "missed", "forward_test", "backtest"] as const;
export const DIRECTIONS = ["long", "short"] as const;
export const BIASES = ["with", "against", "neutral"] as const;
export const REGIMES = ["range", "trend", "unclear"] as const;
export const EXIT_REASONS = ["target", "stop", "invalidation", "manual", "be", "time", "not_filled", "open"] as const;
export const OUTCOMES = ["hit", "miss"] as const;
export const ATTACHMENT_KINDS = ["before", "during", "after"] as const;
/** Tag group the Skips analytics reads; Settings must not rename or delete it. */
export const SKIP_REASON_GROUP = "Skip reason";
export const TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1D", "1W"] as const;

export type SetupStatus = (typeof SETUP_STATUSES)[number];
export type IdeaStatus = (typeof IDEA_STATUSES)[number];
export type Direction = (typeof DIRECTIONS)[number];
export type Bias = (typeof BIASES)[number];
export type Regime = (typeof REGIMES)[number];
export type ExitReason = (typeof EXIT_REASONS)[number];
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];
export type Outcome = (typeof OUTCOMES)[number];

export const setups = sqliteTable("setups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  rules: text("rules").notNull().default(""),
  checklist: text("checklist", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  status: text("status", { enum: SETUP_STATUSES }).notNull().default("testing"),
  defaultTimeframe: text("default_timeframe"),
  color: text("color").notNull().default("#6366f1"),
  ...timestamps,
});

export const ideas = sqliteTable("ideas", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  symbol: text("symbol").notNull(),
  direction: text("direction", { enum: DIRECTIONS }).notNull(),
  status: text("status", { enum: IDEA_STATUSES }).notNull().default("taken"),
  setupId: integer("setup_id").references(() => setups.id, { onDelete: "set null" }),
  entryTimeframe: text("entry_timeframe"),
  htfBias: text("htf_bias", { enum: BIASES }),
  regime: text("regime", { enum: REGIMES }),
  openedAt: text("opened_at").notNull(),
  closedAt: text("closed_at"),
  thesis: text("thesis").notNull().default(""),
  invalidation: text("invalidation").notNull().default(""),
  skipReason: text("skip_reason").notNull().default(""),
  review: text("review").notNull().default(""),
  followedPlan: integer("followed_plan", { mode: "boolean" }),
  riskPct: real("risk_pct"),
  feesUsd: real("fees_usd"),
  pnlUsd: real("pnl_usd"),
  checklistState: text("checklist_state", { mode: "json" })
    .$type<Record<string, boolean>>()
    .notNull()
    .default(sql`'{}'`),
  confidence: integer("confidence"),
  /** Yes/no result for observation-only forward tests (no prices), e.g. "weekly open revisited". */
  outcome: text("outcome", { enum: OUTCOMES }),
  ...timestamps,
},
  (t) => [index("ideas_setup_idx").on(t.setupId)],
);

export const scenarioTypes = sqliteTable("scenario_types", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
});

export const scenarios = sqliteTable("scenarios", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ideaId: integer("idea_id")
    .notNull()
    .references(() => ideas.id, { onDelete: "cascade" }),
  scenarioTypeId: integer("scenario_type_id").references(() => scenarioTypes.id, { onDelete: "set null" }),
  isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
  entry: real("entry").notNull(),
  stop: real("stop").notNull(),
  target: real("target"),
  exitPrice: real("exit_price"),
  exitReason: text("exit_reason", { enum: EXIT_REASONS }),
  notes: text("notes").notNull().default(""),
},
  (t) => [index("scenarios_idea_idx").on(t.ideaId), index("scenarios_type_idx").on(t.scenarioTypeId)],
);

/** Reusable mistake kinds ("Moved stop to BE", "Early TP", …), managed in Settings. */
export const mistakeTypes = sqliteTable("mistake_types", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
});

/** A mistake made on an idea. Cost = costR if set, else (linked alternative R − primary R). */
export const ideaMistakes = sqliteTable("idea_mistakes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ideaId: integer("idea_id")
    .notNull()
    .references(() => ideas.id, { onDelete: "cascade" }),
  mistakeTypeId: integer("mistake_type_id")
    .notNull()
    .references(() => mistakeTypes.id, { onDelete: "cascade" }),
  note: text("note").notNull().default(""),
  costR: real("cost_r"),
  scenarioId: integer("scenario_id").references(() => scenarios.id, { onDelete: "set null" }),
},
  (t) => [
    index("idea_mistakes_idea_idx").on(t.ideaId),
    index("idea_mistakes_type_idx").on(t.mistakeTypeId),
    index("idea_mistakes_scenario_idx").on(t.scenarioId),
  ],
);

export const tags = sqliteTable("tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  group: text("group").notNull().default("General"),
  color: text("color").notNull().default("#64748b"),
});

export const ideaTags = sqliteTable(
  "idea_tags",
  {
    ideaId: integer("idea_id")
      .notNull()
      .references(() => ideas.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  // The composite key covers lookups by idea; this covers lookups by tag (deleteTag, usage counts).
  (t) => [primaryKey({ columns: [t.ideaId, t.tagId] }), index("idea_tags_tag_idx").on(t.tagId)],
);

export const attachments = sqliteTable("attachments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ideaId: integer("idea_id")
    .notNull()
    .references(() => ideas.id, { onDelete: "cascade" }),
  filePath: text("file_path").notNull(),
  caption: text("caption").notNull().default(""),
  kind: text("kind", { enum: ATTACHMENT_KINDS }).notNull().default("before"),
  createdAt: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
},
  (t) => [index("attachments_idea_idx").on(t.ideaId)],
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type Setup = typeof setups.$inferSelect;
export type Idea = typeof ideas.$inferSelect;
export type Scenario = typeof scenarios.$inferSelect;
export type ScenarioType = typeof scenarioTypes.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
export type MistakeType = typeof mistakeTypes.$inferSelect;
export type IdeaMistake = typeof ideaMistakes.$inferSelect;
