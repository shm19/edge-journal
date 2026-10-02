# Data model & math

Source of truth: `src/db/schema.ts`. Migrations are in `drizzle/`: `0000` initial, `0001` adds `ideas.outcome`, `0002` adds `mistake_types` and `idea_mistakes`.

## Tables
| Table | Key columns | Notes |
|---|---|---|
| `setups` | name (unique), description, rules (md), checklist (JSON string[]), status `testing\|live\|retired`, default_timeframe, color | The playbook. Deleting one sets ideas' `setup_id` to NULL. |
| `ideas` | symbol, direction `long\|short`, status (see below), setup_id, entry_timeframe, htf_bias `with\|against\|neutral`, regime `range\|trend\|unclear`, opened_at, closed_at (ISO UTC), thesis, invalidation, skip_reason, review (md), followed_plan, risk_pct, fees_usd, pnl_usd, checklist_state (JSON {item: bool}, ticked only), confidence 1–5, **outcome `hit\|miss`** | One setup occurrence. |
| `scenarios` | idea_id, scenario_type_id (NULL for primary), is_primary, entry, stop, target, exit_price, exit_reason, notes | Exactly one primary per idea, except observation-only forward tests, which have none. |
| `scenario_types` | name (unique), description | Reusable alternative kinds. Deleting one deletes its non-primary scenarios. |
| `mistake_types` | name (unique), description | Reusable mistake kinds, managed in Settings or created inline in the editor. Deleting one deletes its entries. |
| `idea_mistakes` | idea_id, mistake_type_id, note, cost_r, scenario_id → scenarios (set null) | A mistake on an idea. **Cost** = `cost_r` if set, else (linked alternative R − primary R). Positive cost means R was lost. |
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
