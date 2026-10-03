# AGENTS.md — start here

This is the entry point for any agent or developer working on **Edge Journal**: a personal, self-hosted crypto trading journal (Next.js 16 + SQLite). Read this page first, then follow the links you need.

## Documentation index
| Doc | Read it when |
|---|---|
| [docs/workflow.md](docs/workflow.md) | **Before any change.** It's the mandatory 8-stage process: scope → lazy-developer build → code review + product review → apply → tests → docs → browser check → commit. |
| [docs/product.md](docs/product.md) | Before changing **what** the app does. Covers who it's for, the core model, design decisions and non-goals. |
| [docs/architecture.md](docs/architecture.md) | Before changing **how** it works. Covers request flow, folders, server/client split, auth, conventions. |
| [docs/data-model.md](docs/data-model.md) | Before touching the DB, R math or stats. Covers tables, statuses, R definitions and migrations. |
| [docs/testing.md](docs/testing.md) | Before writing or changing tests: how to run them, the `tempDb` helper, fixtures, mocking rules, coverage thresholds and the list of v8-ignored lines. |
| [docs/backtesting.md](docs/backtesting.md) | For backtest scripts, importing trades, or the separate backtest instance. |
| [docs/e2e.md](docs/e2e.md) | Before adding or changing a browser flow test. Covers how `npm run e2e` runs (port 3300, temp DB, system Chrome) and the spec order. |
| [README.md](README.md) | User-facing: features, local run, Docker deploy, backups. |
| [CHECKPOINT.md](CHECKPOINT.md) | **Current status**, what was done last, running instances, next ideas. Update it when you finish a chunk of work. |

## 60-second orientation
- **The user:** Shayan, a beginner discretionary crypto trader (BTC, ETH, XAUT). He works in R-multiples and studies price action from the "Dante course". He wants essentials only, with no bloat.
- **Core model:** an **Idea** is one setup occurrence. Its status is `taken | skipped | missed | forward_test | backtest`. It has a **primary Scenario** (entry/stop/target/exit, from which R is computed) plus optional **alternative Scenarios** typed by **Scenario Types** ("BE stop", "Wick entry", …). Tags live in **groups**, and each group is an analytics dimension.
- **Stats** are computed in memory from `loadIdeas()`, which is fine for a personal journal. All math lives in `src/lib/stats.ts`, which is pure and unit-tested.
- **Desktop only.** There is no mobile support (decided 2026-10-02). Don't build or test phone layouts.
- **Live dashboard numbers use `taken` only.** Skipped, missed, forward-test and backtest ideas are always shown separately and must never be mixed in.

## Environment gotchas (read these)
- **Node 22 is required.** Fresh shells on this machine default to Node 19. Prefix commands with:
  ```bash
  export PATH=/Users/shm/.nvm/versions/node/v22.16.0/bin:$PATH
  ```
- **The npm network is flaky here.** Run installs in the background with `--fetch-retries=6`.
- **Next 16 conventions:**
  - Middleware is `src/proxy.ts` (`export function proxy`).
  - Route `params` and `searchParams` are Promises.
  - Turbopack is the default.
- **"use client" modules only export components to the server.** Shared constants and helpers must live in non-client modules: `src/lib/metrics.ts`, `src/lib/editor-shape.ts`, `src/lib/price.ts`, `src/lib/tz.ts`.
- **The DB opens lazily** (`src/db/index.ts`) and runs migrations and the seed on first use, never at import time. That's why parallel build workers are fine. **After adding a migration, restart the dev server**, because the cached connection predates the new column.
- **Secrets:** the local dev password is `APP_PASSWORD` in `.env.local` (gitignored). Never print it in chat or logs.

## Commands
| Command | Purpose |
|---|---|
| `npm run dev` | Dev server (or `preview_start edge-journal-dev`, configured in `../.claude/launch.json`, on port 3100 with data in `.data-dev`) |
| `npm test` | Vitest (component tests use React Testing Library with `// @vitest-environment jsdom`; `test/setup-dom.ts` adds the matchers): `src/lib/*.test.ts` (R math, stats, analytics, status buckets, price parsing, timezones) plus DB-backed tests (`queries.test.ts`, `actions.test.ts`, `actions-guards.test.ts`, `actions-crud.test.ts`, `auth.test.ts`, `seed.test.ts`, `app/api/routes.test.ts`; `SESSION_SECRET` is set in `test/setup.ts`; `test/db.ts` gives each a temp DB, `test/fixtures.ts` builds `IdeaView`s without one) |
| `npm run e2e` | Playwright browser tests against a production build on port 3300 with a throwaway DB (system Chrome, ~1.5 min). See [docs/e2e.md](docs/e2e.md) |
| `npm run test:coverage` | Vitest with v8 coverage; fails below the thresholds in `vitest.config.mts` (see [docs/testing.md](docs/testing.md)) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint. React-compiler rules are on: no `setState` in effects, no ref reads during render |
| `npm run build` | Production build (standalone output) |
| `npm run db:generate` | Generate a Drizzle migration after editing `src/db/schema.ts` |

## Definition of done for any change
**Every change follows [docs/workflow.md](docs/workflow.md).** That means building with the lazy-developer skill, then two parallel review agents (code + product), applying the triaged comments, tests, docs, and a commit. The list below is the technical bar that the workflow's test and verify stages must meet.
1. `npm test`, `npm run typecheck`, `npm run lint` and `npm run build` all pass.
2. If behaviour changed, click through it in the browser:
   - Log in at `/login`.
   - Check desktop only. The app has **no mobile support** by decision, so don't add phone layouts.
   - Check the browser console for errors.
3. **Math or stats changes:** add or adjust tests in `src/lib/*.test.ts`.
4. **Schema changes:**
   - Add a migration with `npm run db:generate` and commit the `drizzle/` files.
   - Make additive seed changes through `upgrade()` in `src/db/seed.ts`, and bump `SEED_VERSION`.
5. Update `CHECKPOINT.md` with what you did. Update the README if the change is user-facing.
6. Commit each plan step separately (see **Git & commits** below) and record the hash in `CHECKPOINT.md`.
7. Once test coverage exists (plan Step 3b): new code ships with tests and the coverage thresholds must hold. `npm run check` must pass.

## Git & commits
- **Repo.** `edge-journal/` is its own repo, with `main` as the only long-lived branch, and it must always be green. There's no remote yet; pushing needs Shayan's OK.
- **One plan step = its own commit(s)**, following [docs/workflow.md](docs/workflow.md).
  - Commit a schema change together with its `drizzle/` migration.
  - Review fixes can go in a separate `fix(review): …` commit.
- **Messages:**
  - Conventional commits (`feat|fix|refactor|test|docs|chore(scope): …`). Scopes: db, core, auth, ui, analytics, backtest, deps, ci, docs.
  - Imperative subject of 72 characters or fewer; the body explains what and why.
  - Footer: `Refs: Step <n>` plus the Co-Authored-By trailer from the session instructions.
- **Before committing:**
  - The checks are green.
  - Stage explicit paths, never a blind `git add -A`.
  - `git ls-files | grep -E '\.env|\.db'` must only show `.env.example`.
- **Author:** the global git config (`shm`). Confirmed by Shayan.
- **Tags:**
  - Annotated SemVer tags (`git tag -a v0.x.y`): bump the minor version for a feature step, the patch version for fixes.
  - Keep `CHANGELOG.md` `[Unreleased]` up to date in the same commit as the change, and move it under the version when tagging.
  - Tag *after* the CHECKPOINT commit that records the hashes.
- **Rewrites:** allowed only before the first push. Never rewrite history once a remote exists.

## Where to change things
| Task | Files |
|---|---|
| New field on ideas or scenarios | `src/db/schema.ts` → migration → `src/lib/validation.ts` → `src/lib/actions.ts` (`saveIdea`) → `src/lib/editor-shape.ts` → `src/components/idea-editor.tsx` (shell) and the matching card in `src/components/idea-editor/` → `src/app/(app)/ideas/[id]/page.tsx` → CSV in `src/app/api/export/route.ts` |
| Mistakes | `mistakeTypes` / `ideaMistakes` (`schema.ts`), `MistakeView` (`queries.ts`), `mistakeSummary()` (`analytics.ts`), cost rules `mistakeCost()` / `tradeMistakeCost()` (`stats.ts`, see data-model.md), the Mistakes card (`components/idea-editor/mistakes-card.tsx`; cost shown by `editorMistakeCost` in `editor-shape.ts`), `TypeManager kind="mistake"` (`settings-forms.tsx`) |
| Idea editor behaviour (closing time, status switch, Hit/Miss, save payload) | Pure rules + `buildSavePayload` in `src/lib/editor-shape.ts` (test in `editor-shape.test.ts`); rendering in `src/components/idea-editor.tsx` and `src/components/idea-editor/*` |
| A repeated "name · n · win rate · R" list | `src/components/breakdown-list.tsx`; number formats (`fmtProfitFactor`, `fmtDrawdown`) in `src/lib/format.ts` |
| "Pick or create a type" UI (alternatives, mistakes) | `src/components/type-picker.tsx` |
| New analytics "group by" | `DIMENSIONS` + `dimensionKeys()` in `src/lib/analytics.ts` (pure; add a case to `analytics.test.ts`) |
| A new DB read for a page | A function in `src/lib/queries.ts` (server-only). Pages must not import `@/db`. Pure filtering/grouping goes in `src/lib/analytics.ts`. |
| Group statuses / "open" | `src/lib/status.ts` only (`STATUS_BUCKETS`, `inBuckets`, `isOpen`) |
| New metric | `Summary` / `summarize()` in `src/lib/stats.ts` (with a test) and `src/lib/metrics.ts` |
| New status | `IDEA_STATUSES` (`schema.ts`), `STATUS_LABEL` (`format.ts`), `STATUS_COLOR` (`components/bits.tsx`; both are `Record<IdeaStatus, …>` so a missing entry fails the type-check), and put it in a bucket in `src/lib/status.ts` (`status.test.ts` fails until you do). |
| Seed data (setups, tags, scenario types) | `src/db/seed.ts` |
| Navigation | `src/components/nav.tsx` (desktop sidebar only) |
| UI primitives | `src/components/ui.tsx` (Button, Input, Field, Card, Badge, Segmented, …; re-exports `Select`), `src/components/ui/select.tsx` (the one dropdown: Radix Popover + cmdk, native-`<select>` API, no raw `<select>` in the app; test helper `test/select.ts`, e2e helper `chooseOption`), `src/components/ui/date-picker.tsx` (UTC calendar popovers: `DateTimeField`, `DateRangePicker`, `Calendar`; pure date maths in `src/lib/date-input.ts`; no native date inputs; e2e helper `setDateTime`), `src/components/bits.tsx` (RValue, badges, Kpi, Markdown) |
| Charts | `src/components/charts.tsx` (Recharts, client; `EquityChart` takes `money` / `base` for a $ balance curve) |
| Balance simulator | Math `simulateBalance` in `src/lib/stats.ts`; URL params `src/lib/balance.ts`; remembered inputs `src/lib/balance-store.ts`; form `components/balance-form.tsx`, output `components/balance-results.tsx` (Analytics → Balance tab in `analytics/page.tsx`), dashboard card `components/balance-card.tsx`, "Simulate" link on `setups/[id]/page.tsx`. Hypothetical: keep the note and the not-live label. |
