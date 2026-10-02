# Product

## Who it's for
Shayan is a beginner discretionary crypto trader.
- **Markets:** mostly BTC and ETH, sometimes XAUT (gold).
- **Timeframes:** W1 / D1 / H1 / 5m.
- **Method:** price action from the "Dante course".

His Notion (Trading Plan, Strategies, Trading Notes & Learnings) defines how he thinks:
- **R-first.** Expectancy matters; risk varies by setup; skip a trade when R to the **FTA** (first trouble area, i.e. the target) is too small.
- **Setups:**
  - LHPB/LLPB (last high/low pre-break) retest
  - BOS (break of structure) rounded retest
  - SFP (swing failure pattern)
  - Inside-day failure and inside-candle trap
  - ATR-compression fade
  - Hammer / shooting-star entries
- **Hypotheses being forward-tested:** the open-drive candle, and the weekly open being revisited.
- **Rules he wants visible in his data:**
  - Never move the stop to breakeven.
  - No early take-profit, except 3 exceptions.
  - Exit on invalidation.
  - Check HTF bias first.
  - Price approaching a level fast vs drifting into it.
  - Naked vs tested levels.
  - Range vs trend.

His explicit asks: log trades with reasons, setups, coin, time and narrative; test **alternative entries and stops** ("what if I'd moved the stop to BE"); log **skipped** trades and forward tests; see **win rate and R per setup and per tag**, with charts. *"Essential features, nothing I'll never use."* Manual entry, self-hosted, SQLite.

## Core model
- **Idea**: one setup occurrence on a chart. Status:
  - `taken`: real trades. **The only status that counts in live stats.**
  - `skipped`: seen and deliberately not taken. A reason is required. The skip audit asks whether the filter helped.
  - `missed`: a valid setup not caught (execution). A reason is required. It's shown separately from skips.
  - `forward_test`: paper or hypothesis tracking. It either has prices like a trade, or is **observation-only** with `outcome = hit | miss` and no scenarios.
  - `backtest`: produced by backtest scripts or historical review. Kept out of live stats.
- **Scenario**: entry / stop / target / exit / exitReason. One per idea is **primary** (what happened, or the plan). The others are **alternatives**, each typed by a reusable **Scenario Type**. `exitReason = not_filled` means the limit never filled, so the scenario scores **0R**.
- **Setup** (playbook): rules (markdown), checklist, status (`testing | live | retired`), default timeframe, color.
- **Mistakes** are first-class, not tags. Each idea can have mistake entries: a type from Settings, a note, and a cost.
  - The cost is either typed in R, or measured against an **alternative** ("if I hadn't moved the stop, the *Hold to target* alternative made +3R → cost 3R").
  - Adding a mistake to a taken trade sets "Followed plan" to No if it was still blank.
  - The dashboard ranks the costliest mistakes; Analytics groups by "Mistake".
- **Alternatives** are added through a "pick a saved type or create one" block. New types are saved for future trades and managed in Settings.
- **Tags** live in **groups** (Level, Approach, Candle, Context, Skip reason, …). Every group is an analytics dimension. Tag names are unique within a group, case-insensitive.

## Key decisions (and why)
- **R-only by default.** Money fields (risk %, PnL $, fees) are optional and collapsed, because he thinks in R.
- **The stop defines 1R.** For a "BE stop" alternative, keep the initial stop and set exit = entry (the Breakeven quick button). The app rejects stop = entry.
- **Win rate = wins ÷ all closed trades.** Breakevens (within ±BE band, default 0.1R) count as "not a win". Expectancy = mean R.
- **Sample-size honesty.** Show `n` everywhere, show a warning below 20 trades, and label the confidence as "too few", "early" or "solid".
- **Desktop only.** No mobile support; the app is used on a desktop browser.
- **UTC only.** Every time is stored, entered and shown in UTC (`APP_TIMEZONE` in `src/lib/tz.ts`). It isn't configurable: there's no setting and no banner. Weekday and month buckets use UTC. Sessions still use the local hours of London, New York and Tokyo, adjusted for daylight saving.
- **Prices are typed by hand,** so the parser accepts `64,250`, `1.234,5` and `0,5`, and the editor echoes the parsed value.
- **Manual entry first.** There is no exchange sync. Journaling by hand is part of the learning process. Backtests import through scripts.

## Explicit non-goals (don't build without asking)
- AI coach, Monte Carlo, prop-firm rules, exchange API sync, social or sharing features, tax reporting.
- Heavy charting or replay. Screenshots are the chart record.

## Known follow-ups / ideas
These are tracked in `CHECKPOINT.md`:
- CSV/JSON import.
- An "options considered" field.
- An "early take-profit (allowed exception)" exit.
- Cleanup of orphaned uploads.
- Per-KPI greying at small sample sizes.
