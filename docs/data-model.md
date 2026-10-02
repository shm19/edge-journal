# Data model & math

Source of truth: `src/db/schema.ts`. Migrations are in `drizzle/`: `0000` initial, `0001` adds `ideas.outcome`, `0002` adds `mistake_types` and `idea_mistakes`, `0003` adds foreign-key indexes.

## Tables
| Table | Key columns | Notes |
|---|---|---|
| `setups` | name (unique), description, rules (md), checklist (JSON string[]), status `testing\|live\|retired`, default_timeframe, color | The playbook. Deleting one sets ideas' `setup_id` to NULL. |
| `ideas` | symbol, direction `long\|short`, status (see below), setup_id, entry_timeframe, htf_bias `with\|against\|neutral`, regime `range\|trend\|unclear`, opened_at, closed_at (ISO UTC), thesis, invalidation, skip_reason, review (md), followed_plan, risk_pct, fees_usd, pnl_usd, checklist_state (JSON {item: bool}, ticked only), confidence 1–5, **outcome `hit\|miss`** | One setup occurrence. |
| `scenarios` | idea_id, scenario_type_id (NULL for primary), is_primary, entry, stop, target, exit_price, exit_reason, notes | Exactly one primary per idea, except observation-only forward tests, which have none. |
| `scenario_types` | name (unique), description | Reusable alternative kinds. Deleting one deletes its non-primary scenarios. |
| `mistake_types` | name (unique), description | Reusable mistake kinds, managed in Settings or created inline in the editor. Deleting one deletes its entries. |
| `idea_mistakes` | idea_id, mistake_type_id, note, cost_r, scenario_id → scenarios (set null) | A mistake on an idea. **Cost** = `cost_r` if set, else `mistakeCost()` (linked alternative R − primary R). Positive cost means R was lost, negative means the mistake "saved" R. See *Mistake cost* below. |
| `tags` | name, group, color | Name is unique per group (case-insensitive, enforced in `saveTag`). |
| `idea_tags` | idea_id, tag_id | Cascades on delete. |
| `attachments` | idea_id, file_path (`<DATA_DIR>/uploads/<name>`), caption, kind `before\|during\|after` | Files are deleted when the attachment or idea is removed. |
| `settings` | key/value | Keys: `beThresholdR` (0.1), `minRR` (1.5), `defaultRiskPct` (1), `symbols` (CSV), `seedVersion`. There is no timezone setting: the app is UTC-only. |

## Statuses
| Status | Has scenarios | Counted in |
|---|---|---|
| `taken` | yes | Dashboard KPIs, setup "Taken" stats, journal summary bar, analytics default |
| `skipped` / `missed` | yes (hypothetical exit) | Analytics → Skips tab (shown separately), setup card |
| `forward_test` | yes, **or none + `outcome`** | Setup "Forward test" KPI (avg R and/or hit rate), dashboard glance |
| `backtest` | yes | Setup "Backtest" KPI, dashboard glance, analytics when its status chip is selected |

## Indexes (migration 0003)
SQLite does not index foreign keys, so these are explicit: `scenarios(idea_id)`, `scenarios(scenario_type_id)`, `idea_mistakes(idea_id)`, `idea_mistakes(mistake_type_id)`, `idea_mistakes(scenario_id)`, `attachments(idea_id)`, `idea_tags(tag_id)` (the composite primary key already covers `idea_id`), `ideas(setup_id)`. Add one whenever a new foreign key is added.

## Status buckets
`src/lib/status.ts` groups statuses once: **taken**, **skips** (skipped + missed), **forward** (forward_test), **backtest**. Dashboard, setup pages, journal and analytics all use `inBuckets()`. "Open" is `isOpen()`: a primary scenario with no result and no hit/miss outcome. The dashboard's *Open trades* link is `/ideas?status=taken&open=1`, so the count and the list agree. The `Skip reason` tag group name is the constant `SKIP_REASON_GROUP` (`schema.ts`); it can't be renamed or deleted in Settings.

## Exit reasons
`target | stop | invalidation | manual | be | time | not_filled | open`.
- `not_filled` means the order never filled. It scores **0R** and the exit price is NULL.

## R math (`src/lib/stats.ts`)
- `risk = |entry − stop|`.
- `R = sign × (exit − entry) / risk`, where `sign` is +1 for long and −1 for short.
  - `scenarioR()` returns 0 for `not_filled`.
  - It returns null if the trade is open or the risk is 0.
- `plannedRR = sign × (target − entry) / risk`.
- Outcome: |R| ≤ `beThresholdR` is BE; otherwise win or loss by sign.
- `summarize(points)` sorts by date and returns:
  - count, wins, losses, breakevens;
  - winRate = wins / count;
  - avgWin, avgLoss;
  - expectancy = mean R, totalR;
  - profitFactor = Σwin / |Σloss| (null means ∞);
  - maxDrawdown on cumulative R from 0;
  - streaks;
  - followedPlanPct.
- An idea's stats date is `closed_at ?? opened_at`.
- `groupSummaries(points, keysOf)`: a point can fall in several groups (tags), but is counted once per group.
- `compareScenarios(pairs)`: primary vs alternative, for ideas where both are closed.
- `skipAudit(points)`: left on table (Σ positive R), losses avoided (Σ |negative R|), net.
- **Mistake cost** (`mistakeCost(dir, alt, primary)` in `stats.ts`, used by `loadIdeas()` and the editor):
  - cost = R(linked alternative) − R(primary). Positive = R lost; negative = the mistake saved R.
  - It is null if there is no link, the link was deleted, or either scenario is open or has zero risk. A manual `cost_r` always wins over the linked delta.
  - **Overlap rule.** Two mistakes measured against the same alternative describe the same lost R. A *trade's* total (`tradeMistakeCost()`, idea page) counts each linked alternative's delta once, plus every manual cost. Per-mistake-type rows (`mistakeSummary()`, dashboard) sum each mistake's own cost, so type rows are not additive across types.
  - Totals can be partial: show "n of m measured" when `costKnown < count`. Display cost as a signed R with `fmtCost()` (lost = negative), never a hand-written "−".
- Sessions follow daylight saving time:
  - London 07–16 London time.
  - New York 08–17 New York time.
  - When both are open, the session is "London/NY overlap".
  - Asia 09–18 Tokyo time.
  - Otherwise "After hours".

## Migrations & seed
1. Edit `src/db/schema.ts`.
2. Run `npm run db:generate` and commit `drizzle/*`.
3. Migrations run automatically on the first DB use.
4. Restart the dev server.

The seed runs once on an empty DB. Later additive seed changes go in `upgrade()` (`src/db/seed.ts`), gated by `settings.seedVersion` / `SEED_VERSION`, so items the user has deleted are not re-added.

Seed version history:
- **v2** adds the "Skip reason" tag group.
- **v4** deletes the old `timezone` setting (the app became UTC-only).
- **v3** creates the mistake types and converts the old "Mistake" tag group into `idea_mistakes` rows, then deletes those tags.

Note: enum changes on `text(..., { enum })` columns are TypeScript-only and need no migration. New columns do need one.
