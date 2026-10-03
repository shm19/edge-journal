# Changelog

All notable changes are recorded here, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow [SemVer](https://semver.org/).

> **About the history before v0.1.0.** The app was built (2026-10-02, sessions 1–4) before a git repository existed. The commits up to the `v0.1.0` tag are **milestone commits reconstructed from the final state**: the files were grouped by area in dependency order, so `git log` tells the story. Commit timestamps are the time of the reconstruction, not when the work was done. Intermediate commits may not build on their own. `v0.1.0` and every commit after it build and pass the checks. From v0.1.0 on, every plan step and change follows [docs/workflow.md](docs/workflow.md) and gets its own commit(s).

## [Unreleased]
### Security
- Sessions fail closed: the public fallback secret is used only when `NODE_ENV === "development"`; `COOKIE_SECURE` only disables `Secure` when it is exactly `false` (P1-11).
- Security headers: `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `Referrer-Policy: same-origin`, `nosniff`; `X-Powered-By` removed.
- New attachments must exist in the uploads dir and not be used by another idea (P2-7); the `db` backup export is staged in a private temp dir with 0600 permissions (P2-16).

### Added
- One custom, searchable, keyboard-accessible `Select` (Radix Popover + cmdk, `src/components/ui/select.tsx`) replaces every native `<select>`: option groups, search above 8 options, type-ahead, arrows / Home / End / Enter / Esc, combobox + listbox roles, viewport-aware positioning (Step 5). New dependencies `@radix-ui/react-popover` and `cmdk`. Search matches labels only; Tab closes the list without committing; a printable key on the closed trigger opens it and seeds type-ahead; the current option is exposed to screen readers; a non-empty filter in the filter bar gets an accent border; `src/components/ui/select.test.tsx` (19 tests).
- Component tests (React Testing Library): idea editor (live R and R:R, price echo, quick exits, not filled, observation mode, mistake cost, double-submit guard, cancel, setup change), type picker, filter bar Clear, breakdown list, idea actions; pure tests for the editor rules and formatters.
- Warning before changing the Setup would clear ticked checklist items; confirmation before Hit / Miss drops scenarios that have prices.
- Empty states: Analytics with an empty journal, Setups (with a "Create your first setup" button), and a dashboard range with no closed trades.
- Migration `0003`: indexes on foreign keys (`scenarios`, `idea_mistakes`, `attachments`, `idea_tags.tag_id`, `ideas.setup_id`).
- Tests for login guard, session/cookie flags, proxy redirects and 401s, route handlers (uploads, export, health), seed upgrade v1 → current, every idea-schema rule, expired-session actions and attachment checks.
- Tests: DB-backed `saveIdea`, tag-group, query, login-action and proxy tests, the editor rules, and a `toEditorIdea` → `buildSavePayload` → `ideaSchema` round trip (41 → 283 tests).

### Changed
- Server actions return `{ ok: false, error: "Session expired, …" }` instead of redirecting, so an expired session no longer discards an unsaved editor (P1-12).
- Validation: `not_filled` clears the exit price, an exit price needs an exit reason, a target must be on the profit side; errors label the primary scenario by `isPrimary` (P2-6, P2-9).
- `safeNext` and the login throttle moved to `src/lib/login-guard.ts`, `sniff` to `src/lib/image-sniff.ts`, `csvCell` to `src/lib/csv.ts`; `SEED_VERSION` is exported.
- **Closing time:** entering an exit no longer stamps the close time with "now". A blank "Closed" time defaults to the open time, labelled so you can adjust it; "Still open" clears a time the editor filled in. "Now" stays a button.
- **Idea editor** split into a ~270-line shell plus cards in `src/components/idea-editor/` (context, checklist, tags, scenarios, notes, mistakes, screenshots + upload hook, date field); the save payload and the editor's rules are pure functions in `editor-shape.ts`. Behaviour-neutral apart from the fixes below.
- Hit / Miss mode is derived (a forward test with no scenarios) instead of stored.
- The mistake cost shown in the editor follows the server rule (a link to a removed alternative counts as no link).
- Shared `BreakdownList` replaces four copies of the n / win rate / R list; `fmtProfitFactor` / `fmtDrawdown` replace repeated inline formatting, and `Summary.totalR` is `null` for an empty sample.
- `Intl.DateTimeFormat` instances are cached per locale and options (formatting, sessions, weekday, month).
- Idea page: one targeted query per view instead of loading the whole journal three times; prev/next is a cheap indexed query.
- `src/lib/queries.ts` is now DB reads only; pure filtering, dimensions and comparisons moved to `src/lib/analytics.ts`, and status grouping lives in `src/lib/status.ts`. Pages no longer query the DB directly.
- Label maps are typed on the enums, so a new status/exit reason is a compile error until labelled.
- **Validation errors** read `Primary · Target: must be above entry for a long` (no repeated field word), on the client and the server alike; the client counts "Alternative #N" by `isPrimary`.
- **Existing ideas:** the new validation rules (stop and target on the correct side, an exit price needs a reason) can block re-saving an old or imported idea that has a wrong-side target until it is fixed.
- **Closing time:** a loaded idea whose close time equals its open time keeps following *Opened* in the editor; the idea page hints "Closed time = opened time — set the real close time" for a closed trade in that state.
- Mistakes card shows the signed cost with "lost" / "saved", the cost input says "R lost" (positive = lost, negative = saved); the dashboard's Costliest mistakes says "not measured" / "0 of N measured" instead of a bare dash; the idea page tags a mistake whose alternative an earlier mistake already counted with "(shared)".
- Hit / Miss confirmation says how many scenarios it removes.

### Fixed
- **Saving an idea with a stale or foreign scenario id** (deleted in another tab, or belonging to another idea) no longer loses the scenario or fails on a foreign key. It is saved as a new scenario, and a mistake can never link to another idea's scenario.
- **Mistake cost:** the dashboard no longer prints `−-1.00R` for a mistake that saved R; costs are shown as signed R everywhere. The dashboard shows "n of m measured" when only some costs are known, and a trade's total counts each linked alternative once instead of once per mistake. The editor and the server now share one `mistakeCost()` rule.
- The dashboard's *Open trades* count and its link now agree (`/ideas?status=taken&open=1`).
- Renaming or deleting the "Skip reason" tag group is blocked (it feeds the Skips analytics), and the Skips empty state says what is missing.
- Hit / Miss dead end: switching an observation-only forward test to another status now brings back a primary scenario instead of a form that could not be saved.
- A mistake cost that is not a number ("-", "1.2.3") shows "Not a number" and blocks the save instead of being silently discarded.
- A real zero max drawdown shows `0.00R` (not "—"); the Skips cards treat "Left on the table" and "Losses avoided" the same; the setup forward-test KPI hides its sub-line when empty; ideas with no tag in a tag group appear under "No tag" instead of a group called "—".
- Deleting an idea, setup or saved type shows the error instead of navigating away or doing nothing when it fails.
- Editor Cancel goes to the idea (or the journal) instead of the browser history.
- Copy: the Tags card no longer mentions mistakes; the setup page card "With / without mistakes" is now "By mistake type".
- `?status=` filters no longer accept prototype keys like `toString`.
- Login returns an error instead of throwing when `SESSION_SECRET` is missing or too short.
- The editor no longer looks dirty after typing and clearing an exit; risk %, fees and P&L that are not numbers block the save with "Not a number" instead of sending NaN.
- The dashboard's max drawdown is red only when there is a drawdown.

### Removed
- Mobile support: the bottom nav bar, the mobile card list in the journal, the editor's mobile reordering and all `sm:`/`md:`/`lg:` responsive fallbacks. The app shell now has a 1024 px minimum width.
- The "Duplicate" button on the trade page and its server action.

## [0.1.0] - 2026-10-02
### Added
- **Journal core.** Ideas with the statuses taken / skipped / missed / forward test / backtest. Each idea has a primary scenario plus typed alternative scenarios ("what if" entries, stops and exits), with automatic R and planned R:R.
- **Setups (playbook).** Rules in markdown, a checklist, a status (testing / live / retired), stats, an equity curve, breakdowns and a chartbook.
- **Mistakes as a first-class feature.** Mistake types are managed in Settings or created inline. Each mistake has a note and a cost in R, either typed or measured against a linked alternative.
- **Tags in groups.** Groups can be managed: add, rename, move tags between them, delete. Every group is an analytics dimension.
- **Forward tests as hit/miss observations** with no prices (`ideas.outcome`). A **Not filled** exit counts as 0R.
- **Analytics:**
  - Group by setup, tag, tag group, mistake, coin, timeframe, direction, status, HTF bias, regime, session (adjusted for daylight saving), weekday, month, followed plan, exit reason, planned R:R bucket, confidence and checklist score.
  - An actual vs alternative comparison and a skip audit (skipped and missed shown separately).
- **Dashboard.** KPIs, equity curve, R histogram, setup ranking, costliest mistakes, "Needs attention", and range chips (7D/30D/90D/YTD/All).
- **Idea editor:**
  - Comma-safe price parsing with the parsed value echoed back.
  - Quick exits, alternatives and mistakes added through a pick-or-create type picker.
  - Screenshot paste / drag / upload.
  - Unsaved-changes and double-submit guards.
- **Security:**
  - Single-user password login (JWT cookie).
  - A throttle on login attempts.
  - A same-origin `?next=` redirect.
  - Uploads checked by their actual file contents, with `nosniff`.
  - CSV formula-injection guard.
- **Export.** CSV, JSON and a SQLite backup. `scripts/backup.sh`.
- **Deploy.** Docker (standalone build, `/data` volume, healthcheck) and docker-compose.
- **Backtesting.** Scripts that work for any coin (`fetch-1h.py`, `backtest-hammer-thrust.py`, `import-hammer-thrust.py`). H1 hammer + thrust results for BTC, ETH and XAUT (Sep 2026).
- **Docs.** `AGENTS.md`, `docs/` (product, architecture, data model, backtesting, change workflow), `CHECKPOINT.md`.
- **Tests.** 41 unit tests for the R/stats engine, price parsing and timezone helpers.
- **UTC-only time handling.** Times are not configurable; seed v4 removes the old timezone setting.

Notes: the app is desktop only by decision. The remaining mobile code is due for removal in plan Step 2b.
