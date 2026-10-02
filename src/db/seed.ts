import { count, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

type DB = BetterSQLite3Database<typeof schema>;

const COMMON_CHECKS = ["HTF bias checked (W1 / D1)", "Planned R:R to FTA ≥ minimum", "Invalidation defined before entry"];

const SETUPS: (typeof schema.setups.$inferInsert)[] = [
  {
    name: "LHPB / LLPB retest",
    color: "#6366f1",
    status: "live",
    defaultTimeframe: "1h",
    description: "Trade the last high pre-break (long) or last low pre-break (short) when price returns to it.",
    rules: [
      "- Entry: last high before the break (long) / last low before the break (short).",
      "- If the candle before the break is a spike (hammer / shooting star) with a long opposite wick, use that candle's extreme instead.",
      "- Stop: beyond the level / thrust candle (consider a small ATR buffer instead of 1 tick).",
      "- Target: the FTA.",
      "- Don't stand in front of key structure being taken.",
    ].join("\n"),
    checklist: [...COMMON_CHECKS, "Level is naked (untested on LTF)", "Price accelerated through the level", "Not past ATR"],
  },
  {
    name: "BOS rounded retest",
    color: "#22c55e",
    status: "live",
    defaultTimeframe: "1h",
    description: "Break of structure at a key level with acceleration, then a rounded (curved) retest of the new level.",
    rules: [
      "1. Breakdown/breakout at a key level (HTF levels weigh more).",
      "2. Mark the swing: last high pre-break / last low pre-break.",
      "3. Wait for the retest — require a rounded retest, not a V-shaped snap back (especially in a range).",
      "4. Target FTA; stop one tick (or small buffer) beyond the thrust candle.",
      "5. If the neighbouring candle moved hard the opposite way (long wick), use its extreme as the level.",
    ].join("\n"),
    checklist: [...COMMON_CHECKS, "Break happened with acceleration", "Retest is rounded, not V-shaped", "Level not tested on LTF"],
  },
  {
    name: "Swing Failure Pattern (SFP)",
    color: "#f59e0b",
    status: "live",
    defaultTimeframe: "1h",
    description: "Price sweeps a major swing, fails and closes back inside the range — trade the trapped breakout crowd.",
    rules: [
      "- Best in a range, at a level that's already been traded/tested.",
      "- Decide order type before the sweep: market on close back inside, or limit at the deviation.",
      "- No sweep = no setup.",
      "- Stop beyond the sweep wick; target opposite side of range / FTA.",
      "- Must be a major level where stops actually rest.",
    ].join("\n"),
    checklist: [...COMMON_CHECKS, "Major swing / level", "Clear sweep and close back inside", "R:R still OK after deep sweep"],
  },
  {
    name: "Inside day failure",
    color: "#ec4899",
    status: "live",
    defaultTimeframe: "1D",
    description: "Mother bar → inside day (high/low inside) → trigger day breaks one side, sweeps stops and reverses to the other side.",
    rules: [
      "- Judge 'inside' by high/low incl. wicks, not open/close. Works on weekly too.",
      "- Expect price to take the inside-day high and the LHPB, then come back into the key level.",
      "- Pre-place a limit at the key level for the reversal.",
      "- Stop beyond the sweep; target the other end of the inside day / FTA.",
    ].join("\n"),
    checklist: [...COMMON_CHECKS, "Inside day confirmed (closed)", "Key level under/over inside day mapped"],
  },
  {
    name: "Inside candle trap",
    color: "#14b8a6",
    status: "testing",
    defaultTimeframe: "1D",
    description: "Key level + HTF inside candle creates a range; trade the reverse of the trapped crowd.",
    rules: "Core ingredients: key level, inside candle on the HTF, trapped traders. Enter once the trap is confirmed.",
    checklist: [...COMMON_CHECKS, "Key level", "HTF inside candle", "Trap confirmed"],
  },
  {
    name: "ATR compression fade",
    color: "#8b5cf6",
    status: "testing",
    defaultTimeframe: "1h",
    description: "After an ATR squeeze expands, fade the retest of the flipped level back to the FTA.",
    rules: [
      "1. ATR compressed — mark the squeeze range and the prior swing high/low.",
      "2. Expansion up → prior low flips to resistance → short its retest to the FTA below.",
      "3. Expansion down → prior high flips to support → long its retest to the FTA above.",
      "4. Short-term counter-move, not a new trend.",
    ].join("\n"),
    checklist: [...COMMON_CHECKS, "ATR clearly compressed before", "Expansion looks overextended"],
  },
  {
    name: "Hammer / Shooting star",
    color: "#ef4444",
    status: "live",
    defaultTimeframe: "1D",
    description: "Spike-candle entries: hammer high / shooting-star low as levels; rebid the hammer head.",
    rules: [
      "- Hammer → key level is its high; shooting star → its low.",
      "- Short a shooting star at the candle high (or high of the prior day with bearish bias).",
      "- Long the hammer high, take FTA, rebid the hammer head.",
      "- Pattern failure: engulfing back through the hammer → it runs the stops below.",
    ].join("\n"),
    checklist: [...COMMON_CHECKS, "Candle closed (D1)", "Context / bias supports it"],
  },
  {
    name: "Open drive",
    color: "#0ea5e9",
    status: "testing",
    defaultTimeframe: "30m",
    description: "First 30m candle at US open with open = high/low (no wick) tends to be revisited in the same session.",
    rules: "Hypothesis to forward-test. Log every occurrence as a forward-test idea.",
    checklist: ["Open = high or low (no wick on origin side)"],
  },
  {
    name: "Weekly open revisit",
    color: "#a3e635",
    status: "testing",
    defaultTimeframe: "1h",
    description: "When Monday closes away from the weekly open, ~70% chance price revisits it that week (often Tuesday).",
    rules: "Hypothesis to forward-test on BTC and ETH. Log every week as a forward-test idea.",
    checklist: ["Monday closed away from weekly open"],
  },
];

const SCENARIO_TYPES: (typeof schema.scenarioTypes.$inferInsert)[] = [
  { name: "BE stop", description: "What if I'd moved the stop to breakeven?" },
  { name: "Wick entry", description: "Enter into the wick, beyond the level." },
  { name: "Wick target", description: "Target the wick price instead of the clean level." },
  { name: "ATR stop", description: "Stop with an ATR buffer instead of 1 tick." },
  { name: "1-tick stop", description: "Tightest stop beyond the thrust candle." },
  { name: "Hold to target", description: "No early exit — let it hit the original target or stop." },
  { name: "Rebid hammer head", description: "Re-entry at the hammer head after taking FTA." },
  { name: "Alt level", description: "A different level from the options I considered." },
];

const TAGS: Record<string, { color: string; names: string[] }> = {
  Level: { color: "#6366f1", names: ["Naked", "Tested", "WSH", "Weekly open", "Daily level", "VAH/VAL/POC"] },
  Approach: { color: "#0ea5e9", names: ["Accelerating", "Drifting"] },
  Candle: { color: "#f59e0b", names: ["Hammer", "Shooting star", "Spike", "Engulfing", "Inside day", "Thrust"] },
  Context: { color: "#22c55e", names: ["HTF confluence", "News (CPI/NFP/FOMC)", "Weekend", "Range high/low"] },
  "Skip reason": {
    color: "#a1a1aa",
    names: ["R:R too small", "Against HTF bias", "Drifting into level", "Level already tested", "Not at screen", "News risk", "Didn't trust the pattern"],
  },
};

const MISTAKE_TYPES: (typeof schema.mistakeTypes.$inferInsert)[] = [
  { name: "Moved stop to BE", description: "Cut a valid trade by moving the stop to breakeven." },
  { name: "Early TP", description: "Took profit before the target without one of the 3 exceptions." },
  { name: "No HTF bias", description: "Traded without checking / against the higher-timeframe bias." },
  { name: "R too small", description: "Took a trade whose R:R to the FTA was below the minimum." },
  { name: "Impatience / FOMO", description: "Entered before the setup completed, or chased." },
  { name: "Moved target", description: "Changed the target mid-trade out of fear or greed." },
  { name: "Revenge", description: "Traded to win back a loss." },
  { name: "Oversized", description: "Risked more than planned." },
  { name: "Ignored invalidation", description: "Stayed in after the idea was invalidated." },
];

const SEED_VERSION = 4;

/** Additive seed upgrades for existing databases (never re-adds things the user deleted after the upgrade). */
function upgrade(db: DB) {
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, "seedVersion")).get();
  const version = row ? Number(row.value) : 1;
  if (version >= SEED_VERSION) return;
  db.transaction((tx) => {
    if (version < 4) {
      // The app is UTC-only now; drop the old configurable timezone.
      tx.delete(schema.settings).where(eq(schema.settings.key, "timezone")).run();
    }
    if (version < 3) {
      // Mistakes become first-class: create mistake types, convert "Mistake"-group tags into mistake entries.
      if (!tx.select({ id: schema.mistakeTypes.id }).from(schema.mistakeTypes).limit(1).all().length) {
        tx.insert(schema.mistakeTypes).values(MISTAKE_TYPES).run();
      }
      const typeByName = new Map(tx.select().from(schema.mistakeTypes).all().map((t) => [t.name.toLowerCase(), t.id]));
      const mistakeTags = tx.select().from(schema.tags).where(eq(schema.tags.group, "Mistake")).all();
      for (const tag of mistakeTags) {
        let typeId = typeByName.get(tag.name.toLowerCase());
        if (!typeId) {
          typeId = tx.insert(schema.mistakeTypes).values({ name: tag.name }).returning({ id: schema.mistakeTypes.id }).get().id;
          typeByName.set(tag.name.toLowerCase(), typeId);
        }
        const uses = tx.select().from(schema.ideaTags).where(eq(schema.ideaTags.tagId, tag.id)).all();
        if (uses.length) tx.insert(schema.ideaMistakes).values(uses.map((u) => ({ ideaId: u.ideaId, mistakeTypeId: typeId! }))).run();
        tx.delete(schema.tags).where(eq(schema.tags.id, tag.id)).run();
      }
    }
    if (version < 2) {
      const existing = tx.select().from(schema.tags).where(eq(schema.tags.group, "Skip reason")).all();
      if (!existing.length) {
        const { color, names } = TAGS["Skip reason"];
        tx.insert(schema.tags).values(names.map((name) => ({ name, group: "Skip reason", color }))).run();
      }
    }
    tx.insert(schema.settings)
      .values({ key: "seedVersion", value: String(SEED_VERSION) })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value: String(SEED_VERSION) } })
      .run();
  });
}

export function seedIfEmpty(db: DB) {
  const [{ n }] = db.select({ n: count() }).from(schema.setups).all();
  const [{ t }] = db.select({ t: count() }).from(schema.scenarioTypes).all();
  if (n > 0 || t > 0) return upgrade(db);

  db.transaction((tx) => {
    tx.insert(schema.setups).values(SETUPS).run();
    tx.insert(schema.scenarioTypes).values(SCENARIO_TYPES).run();
    tx.insert(schema.mistakeTypes).values(MISTAKE_TYPES).run();
    for (const [group, { color, names }] of Object.entries(TAGS)) {
      tx.insert(schema.tags)
        .values(names.map((name) => ({ name, group, color })))
        .run();
    }
    tx.insert(schema.settings)
      .values([
        { key: "beThresholdR", value: "0.1" },
        { key: "minRR", value: "1.5" },
        { key: "defaultRiskPct", value: "1" },
        { key: "symbols", value: "BTC,ETH,SOL,XAUT" },
        { key: "seedVersion", value: String(SEED_VERSION) },
      ])
      .run();
  });
}
