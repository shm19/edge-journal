# Edge Journal — checkpoint (2026-10-02, session 4)

Personal, self-hosted crypto trading journal. **Agents: start with `AGENTS.md`** (doc index + conventions). Setup and deploy instructions are in `README.md`. The original plan is in `/Users/shm/.claude/plans/do-a-comperhensive-product-stateless-cloud.md`.

**To resume:** tell Claude "continue the Edge Journal plan from CHECKPOINT.md" — it should do the **next unchecked step** in the PLAN section only, then stop for review.

## Status: v1 complete; PM, QA and backtest findings fixed
`npm test` (41 passed), `typecheck`, `lint` and `build` are all clean. Changes since the review round:

**Security**
- Open redirect after login fixed (`safeNext`). The `?next=` parameter now keeps its query string.
- Login throttle is per client and resets once the lock expires.
- Uploads: image type checked from file content, size checked early, upload route excluded from the proxy (it checks auth itself), `nosniff` header added.
- CSV export guards against spreadsheet formula injection.

**Data correctness**
- Prices parse safely: `64,250`, `1.234,5` (`src/lib/price.ts`), and the editor echoes the parsed value.
- The editor enters and shows times in the Settings timezone (`src/lib/tz.ts`).
- The journal's date filter uses the display timezone.
- Sessions follow daylight saving time.
- Tags are counted once per group; duplicate tag names are blocked.
- Missing setups and scenario types fall back gracefully.

**Editor**
- Double-save guard.
- Unsaved-changes guard.
- Close time is stamped automatically on exit, and the date fields have "Now" buttons.
- On mobile the prices come right after the basics.
- Pinned alternatives: BE stop, Hold to target, Wick entry.

**New features**
- **Backtest** status, kept out of live stats.
- **Hit / Miss** forward tests with no prices (`ideas.outcome`, migration `0001`).
- **Not filled** exit (counts as 0R).
- "Skip reason" tag group (seed upgrade v2).
- New analytics dimensions: exit reason, planned R:R bucket, confidence, checklist score.
- Dashboard: a 7D range, a "Needs attention" card, an open-trades filter (`?open=1`) and a small-sample warning.
- Skips tab: skipped and missed shown separately, plus a breakdown by reason.
- Setup page: hit rate, backtest stats, and an equity curve that falls back to backtests.

**UI**
- Mobile nav includes Settings, and Settings has Sign out.
- Fixed: mobile overflow, long-word wrapping, neutral checklist marks, histogram labels, contrast, aria states.

## Latest (session 3, later)
- Tag manager rewrite (Settings):
  - click a tag to rename, recolor, move to another group or delete;
  - per-group Add / Rename / Delete;
  - "+ New group…" in the group picker.
  - Actions: `renameTagGroup`, `deleteTagGroup`.
- Editor: one-tap coin buttons under the Coin field (from Settings → Coins you trade). Any coin can be typed.
- Backtest scripts work for any coin (`fetch-1h.py --symbol/--coin`, `--from/--to`). ETH and XAUT backtests were imported into `.data-backtest`. See `docs/backtesting.md`.
- Docs: `AGENTS.md` (+ `CLAUDE.md` → `@AGENTS.md`) and `docs/{product,architecture,data-model,backtesting}.md`.

## Latest (session 3, mistakes & alternatives)
- **Mistakes are first-class:**
  - Tables `mistake_types` and `idea_mistakes` (migration `0002`). Seed v3 converts the old "Mistake" tags.
  - Editor: a Mistakes card where you pick or create a type, add a note, and set a cost. The cost is either typed in R or measured against a linked alternative (alt R − primary R).
  - The trade page shows each mistake with its cost.
  - Dashboard: "Costliest mistakes", ranked by R cost, plus the % of trades with a mistake.
  - Analytics: group by "Mistake". The setup page shows a mistake breakdown.
  - Journal list: a mistake badge on affected trades.
  - CSV and JSON exports include mistakes.
  - Settings: a "Mistake types" manager.
- **Alternatives:** a new `TypePicker` block with quick chips, all saved types, and "New type" (created inline and saved).
- Verified in the browser: ETH trade closed at BE, plus a Hold-to-target alternative at +3R, plus a "Moved stop to BE" mistake linked to it → cost 3.00R. Edit round-trip and dashboard checked.

## Running instances (local)
- **Dev server:** `preview_start edge-journal-dev` on http://localhost:3100. Data in `.data-dev` is QA test data and can be thrown away.
- **Backtest instance:** http://127.0.0.1:3200, the production build from `.next/standalone`, data in `.data-backtest`. To restart:
  ```bash
  cd .next/standalone && set -a && . ../../.env.local && set +a && PORT=3200 HOSTNAME=127.0.0.1 DATA_DIR=$PWD/../../.data-backtest COOKIE_SECURE=false NODE_ENV=production node server.js
  ```
- The password for both is `APP_PASSWORD` in `.env.local`.
- Use **Node 22**: `export PATH=/Users/shm/.nvm/versions/node/v22.16.0/bin:$PATH`.

## PLAN — next steps, one at a time
Requested by Shayan on 2026-10-02. **Do one step per session.**
1. Finish the step's "Done when" checks.
2. Update this file: tick the box and add notes.
3. Stop and let him review before starting the next step.

**Desktop only (decided 2026-10-02):** there's no mobile support, so don't build or test phone layouts.

Every step must also pass the usual checks: `npm test`, `typecheck`, `lint`, `build`, and a desktop browser check.

**After Step 0, every step is also:**
- its own git commit (or a few), using conventional messages such as `feat: …`, `fix: …`, `refactor: …`, `test: …`, `docs: …`, `chore: …`;
- recorded with its commit hash in this file.

**After Step 3b:** coverage must not drop below the thresholds.

**Recommended order:** ~~0~~ → ~~2~~ → ~~2b~~ → ~~3~~ → ~~4~~ → ~~3b~~ → ~~5~~ → ~~6~~ → ~~7~~ 5 → 6 → 7. (Step 0 is done.)

**Process for every step and change:** follow [docs/workflow.md](docs/workflow.md).
1. Scope.
2. Build with the **lazy-developer** skill.
3. Run **two review agents in parallel**: a code reviewer and a product reviewer, report only.
4. Triage and apply.
5. Add or update tests and run them all.
6. Update the docs.
7. Check in a desktop browser.
8. Commit and record.

Copy the workflow's checklist into each step's notes and tick it as you go.

**Note on the steps themselves:**
- Step 0 (git setup) is repository setup with no app code. It still gets a code review of the `.gitignore` and of which files are tracked, but the product review is skipped. Record that decision in its notes.
- Step 3 is itself a review, so Stage 3 there is the senior review. When you're done, restart both local instances. After any schema change, the dev server needs a restart, and the 3200 instance needs a rebuild and restart.

### ☑ Step 0: Git repository and complete history (done 2026-10-02)
**Workflow checklist:**
- [x] 1 Scope
- [x] 2 Built with Shayan's own lazy-developer skill. Rung 3/4: plain git and native ignore files; no new tooling.
- [x] 3a Code review received
- [—] 3b Product review **skipped by decision**: repository setup only, no app or UX change.
- [x] 4 Triage applied (see below)
- [x] 5 Checks on a fresh clone: typecheck, 41 tests, lint and build all green.
- [x] 6 Docs updated: AGENTS "Git & commits", the workflow's skill source, CHANGELOG.
- [—] 7 Browser check: n/a, no UI change.
- [x] 8 Committed and tagged `v0.1.0`.

**What was done:**
- `git init -b main` in `edge-journal/`, using the global identity `shm <malekishayan79@gmail.com>`, as Shayan confirmed.
- `.gitignore` tightened:
  - `/.data-*`: `.data-backtest` was previously **not** ignored.
  - DB files.
  - The regenerable `*-1h.json` candles and backtest screenshots.
  - Playwright and coverage output, editor files, logs.
- `.dockerignore` matched to it.
- `.env.example` gained `BACKUP_DIR` and `TZ`.
- A secret scan found the `.env.local` values in no tracked files and nowhere in history.
- **History.** 7 reconstructed milestone commits, then a record commit, then the `v0.1.0` tag. The plan listed 8 milestones; mistakes, alternatives and tag groups were folded into the app commit, whose body covers them. The CHANGELOG explains the reconstruction.

**Review triage (code reviewer):**
- **Applied:**
  - commit the workflow edit;
  - AGENTS "Git & commits" section;
  - `.dockerignore`;
  - `.gitignore` gaps;
  - `.env.example` additions;
  - CHANGELOG format and timestamp note;
  - fixed commit dependency order (`ui.tsx` now ships with the auth commit), `backup.sh` moved to the scaffold commit, the docs subject kept to 72 characters or fewer.
- **Asked:** the author identity. Shayan said keep the global config.
- **Deferred:**
  - the personal paths and profile details in the docs (they only matter if the repo goes public; a push needs Shayan's OK);
  - a pre-commit secret hook, `.gitattributes`, and per-step branches (Backlog);
  - the unused scaffold SVGs (added to the Step 4 list).

**Commits** (milestones, oldest first). This record commit is tagged `v0.1.0`:
- `35178d3` chore: scaffold Next.js 16 app, tooling and Docker deploy
- `19445d6` feat(db): schema, migrations and versioned seed
- `99eb421` feat(core): R/stats engine, price parsing and UTC helpers with tests
- `4936735` feat(auth): password login, JWT session, proxy gate, UI primitives
- `868b59c` feat: journal, idea editor, setups, analytics, settings and APIs
- `141fc82` feat(backtest): coin-agnostic hammer + thrust backtest scripts and results
- `56daf48` docs: agent guide, product/architecture/data docs, checkpoint, changelog

**Original plan:**
Reason: there's no git repo yet (neither `edge-journal/` nor its parent). Every later step should be a reviewable, revertible commit.

**1. Initialise the repo:**
- Run `git init` inside `edge-journal/` so it's its own repo, separate from the unrelated files in `claude-done/`. Use `main` as the default branch.
- Set the author to Shayan's git identity (ask if `git config user.name/email` is unset).
- Commits include the `Co-Authored-By` trailer from the session's attribution instructions.

**2. Audit `.gitignore` before the first commit.** These must stay out:
- `node_modules`, `.next`;
- `.env*` (except `.env.example`);
- `data/`, `.data-dev/`, `.data-test/`, `.data-backtest/`, `backups/`;
- `*.db`, `*.db-wal`, `*.db-shm`;
- uploads.

**3. Check the commit is clean:**
- Run a secrets sanity check (grep the staged files for passwords and secrets) before committing.
- Decide on `scripts/backtest-data/` (about 1.9 MB of candles, trade JSON and screenshots). Recommendation: commit the small `*-trades.json` files plus the scripts, and git-ignore the raw candle JSON (`*-1h.json`) and `screenshots/`, since they can be regenerated.

**4. Reconstruct a readable history.** There was no repo during the build, so a real step-by-step history can't be recovered. Instead, make honest **milestone commits**: stage the current files in logical groups, in dependency order, so `git log` tells the story. For example:
1. `chore: scaffold Next.js 16 app, tooling, Docker`: config, package files, Dockerfile, compose, `.gitignore`, README.
2. `feat(db): schema, migrations, seed`: `src/db`, `drizzle/`.
3. `feat(core): R/stats engine, price & UTC helpers + tests`: `src/lib/{stats,price,tz}*`.
4. `feat(auth): password login, session, proxy`.
5. `feat: journal, idea editor, setups, analytics, settings`: pages and components.
6. `feat: mistakes, alternatives type picker, tag groups`.
7. `feat(backtest): coin-agnostic backtest scripts + data`.
8. `docs: AGENTS.md, docs/, CHECKPOINT`.

Each commit message body summarises what that milestone contains, using the "Status" and "Latest" sections of this file as the source.
- Add a `CHANGELOG.md` (Keep a Changelog format) with the session history.
- Tag the result `v0.1.0`.
- Note in the CHANGELOG that the history was reconstructed from the final state, so intermediate commits may not build on their own. The tag and every commit after it will build.

**5. Remote (optional, ask first).** Pushing to GitHub is outward-facing, so get Shayan's OK and the repo name and visibility before running `gh repo create … --private --source . --push`. If he agrees, add a GitHub Actions workflow (`.github/workflows/ci.yml`) running `npm ci`, lint, typecheck, test with coverage, and build on Node 22.

**Done when:**
- `git log --oneline` shows the milestone commits and the `v0.1.0` tag.
- `git status` is clean.
- No secrets or DB files are tracked (`git ls-files | grep -E "\.env|\.db"` shows only `.env.example`).
- `AGENTS.md` describes the commit conventions and "one commit per plan step".

### ☑ Step 1: UTC only, timezone not changeable (done 2026-10-02)
**What was done:**
- Removed:
  - `TimezoneHint`;
  - the `setTimezone` action;
  - the timezone field from the settings schema, `saveSettings`, `getSettings` and the seed;
  - every timezone prop and parameter (`IdeaTable`, `IdeaEditor`, `applyFilters`, `dimensionKeys`, the `fmtDate*` functions).
- Added `APP_TIMEZONE = "UTC"` (`src/lib/tz.ts`).
- `fmtDateTime` appends "UTC".
- The editor labels read "Opened (UTC)" / "Closed (UTC)".
- Settings shows a disabled "UTC" field.
- The journal header says "times in UTC".
- Seed v4 deletes the stored `timezone` key.

**Verified:**
- Checks: tests (41), typecheck, lint and build all pass.
- Browser: typed 14:00 → shown as "01 Oct 2026, 14:00 UTC"; no banner; the Settings field is disabled; no overflow at 375 px; no console errors.
- Both instances restarted, and the key is gone from `.data-dev`.

**Original plan:**
Reason: all times should be UTC. There should be no setting and no banner.
- **Remove:**
  - `TimezoneHint` (`src/components/timezone-hint.tsx`) and its use in `src/app/(app)/layout.tsx`;
  - the `setTimezone` action (`src/lib/actions.ts`);
  - the timezone field and "use device timezone" hint in `GeneralSettings` (`src/components/settings-forms.tsx`);
  - `timezone` from `settingsSchema` and `saveSettings`.
- **`getSettings()`** (`src/lib/settings.ts`): always return `timezone: "UTC"`. Ignore any stored key; a seed upgrade v4 can delete it.
- **Editor:** label the date fields "Opened (UTC)" / "Closed (UTC)" and keep using `isoToZonedInput` / `zonedInputToIso` with `"UTC"`.
  - Simpler alternative: replace them with a UTC helper and delete the zone helpers from `src/lib/tz.ts`, keeping `zonedHour` for sessions.
- **Display:** keep calling the formatters with `"UTC"` so there's a single code path. Show a small "UTC" marker next to times on the idea page and in the journal header.
- **Docs:** `docs/product.md` ("Times…" decision), `docs/architecture.md` (conventions), README.
- **Done when:** no timezone UI exists anywhere; a time typed as 14:00 shows as 14:00 UTC on every page; analytics weekday and month buckets use UTC.

### ☑ Step 2: Remove "Duplicate trade" (done 2026-10-02)
**Workflow checklist:**
- [x] Scope.
- [x] Built with the lazy-developer skill. Rung 1, delete: 40 lines removed, 0 added.
- [x] Code review: no P0/P1.
- [x] Product review: no P0/P1.
- [x] Triage:
  - Applied: tick this step.
  - Deferred to Backlog: the Delete button ignores the `deleteIdea` result (this was already the case before the change).
- [x] Typecheck, lint, 41 tests and build all green.
- [x] Docs: CHANGELOG. No other doc mentioned the feature.
- [x] Browser: the trade page shows only Edit and Delete, with no console errors.
- [x] Committed (see `git log`).

**What was done:** removed the `duplicateIdea` server action (`src/lib/actions.ts`) and the Duplicate button (`src/components/idea-actions.tsx`).

**Original plan:**
- **Remove:**
  - `duplicateIdea` from `src/lib/actions.ts`;
  - the Duplicate button from `src/components/idea-actions.tsx`;
  - its mention in the docs.
- **Done when:** grep finds no `duplicate` references in the idea flow; the trade page shows only Edit and Delete.

### ☑ Step 2b: Remove mobile support (desktop only) (done 2026-10-02)
**Workflow checklist:**
- [x] 1 Scope (below)
- [x] 2 Built with Shayan's lazy-developer skill. Rung 1, delete: net about -70 lines. Responsive prefixes collapsed to their desktop values, `xl:` kept.
- [x] 3a Code review: no P0.
- [x] 3b Product review: no P0 (diff-only; the reviewer could not log in).
- [x] 4 Triage (below)
- [x] 5 Typecheck, lint, 41 tests and build green. No new tests: the change is CSS classes and deleted markup, and the e2e smoke test comes in Step 3b.
- [x] 6 Docs: AGENTS, architecture, README, CHANGELOG.
- [x] 7 Browser at 1024 px: editor (two columns, sticky save bar), journal, dashboard; no console errors.
- [x] 8 Committed: `ce451ad`

**What was done:** deleted the mobile bottom bar and `MobileItem`, the journal's mobile card list and the editor's `contents`/`order-*` reordering. The sidebar is always shown. The app shell has `min-w-[1024px]`, so `sm:`/`md:`/`lg:` are always on and were collapsed to unconditional classes; `xl:` is kept. `/login` stays responsive.

**Review triage:**
- Applied: stale docs, empty `className=""` leftovers, class order normalised (`grid grid-cols-* gap-*`), a `/login` note in architecture.md.
- Rejected: restoring `lg:` fallbacks for windows under 1024 px. The plan asks for a minimum page width, and the app is desktop only.
- Deferred: the journal table's right-hand columns are clipped at exactly 1024 px (the `overflow-hidden` wrapper). This was already the case before; see Backlog.

**Original plan:**
Reason: Shayan uses the app on desktop only. Removing the mobile code simplifies everything after this step.
- **`src/components/nav.tsx`:**
  - Delete the mobile bottom bar and the `MobileItem` component.
  - Always show the sidebar (drop `hidden md:flex`).
- **`src/app/(app)/layout.tsx`:**
  - Drop the bottom padding reserved for the mobile bar (`pb-24`).
  - Simplify the responsive padding.
  - Set a sensible minimum page width (e.g. `min-w-[1024px]`) so the layout never collapses.
- **`src/components/idea-table.tsx`:** delete the mobile card list and keep only the table (drop `hidden md:block`).
- **`src/components/idea-editor.tsx`:**
  - Remove the `contents lg:block` and `order-*` mobile-reordering trick; use plain two-column `space-y-5` columns.
  - Remove the mobile `bottom-20` sticky offset (use `bottom-4`), the `md:` hint toggles, and the `sm:` collapses in the editor grids, where they only exist for phones.
- **Elsewhere:** sweep the pages and components for responsive prefixes that only serve small screens (`sm:` / `md:` grid fallbacks, `flex-wrap` used only for phones). Keep `lg:` / `xl:` where they help on narrow desktop windows.
- **Docs:**
  - `AGENTS.md` definition of done: drop the 375 px check.
  - `docs/architecture.md`: replace the "Mobile" convention with "Desktop only".
  - `docs/product.md`: add the "Desktop only" decision.
  - README: list it under the features.
- **Done when:** no mobile-only code paths remain (grep for `md:hidden`, `hidden md:`, `MobileItem`, `bottom-20`); desktop looks unchanged; checks pass.

### ☑ Step 3: Senior code review (agent, report only) (done 2026-10-02)
**Result:** report in [docs/review-2026-10-02.md](docs/review-2026-10-02.md): 2 P0, 12 P1, 16 numbered P2 items. No code was changed. Triage with Shayan happens at the start of Step 4.
- P0: `saveIdea` stale scenario ids; mistake cost shows `−-1.00R`, double-counts when two mistakes share an alternative, and partial totals look complete.
- Top P1: the idea page loads the whole DB three times; missing indexes; status filtering scattered (32 comparisons in 5 files); `queries.ts` can't be unit-tested because of `server-only`; untested areas; auto close time skews backdated trades; fail-open session secret and cookie flag.
- Workflow: review-only step, so there was no build and no product review; the senior review is the deliverable. No browser check (no UI change).

**Original plan:**
Run one senior reviewer agent. It should read `AGENTS.md` and all of `docs/` first, must not edit code, and writes its report to `docs/review-YYYY-MM-DD.md`. It should cover:
- **Architecture and boundaries:** server/client split, the "use client" export rules, where business logic lives.
- **Duplication and file size:**
  - `src/components/idea-editor.tsx` is about 950 lines.
  - `src/app/(app)/analytics/page.tsx` has tab logic in inline functions.
  - Breakdown lists are repeated on the dashboard, setup and analytics pages.
- **Performance:**
  - `loadIdeas()` loads the whole DB on every page.
  - The idea detail page loads every idea just for prev/next.
  - `getIdea` loads all tags and scenarios.
  - Missing indexes on `scenarios.idea_id`, `idea_tags`, `idea_mistakes.idea_id`.
- **Correctness:** status filtering is scattered across pages (taken / backtest / forward / skipped). Should it be one helper? Check the mistake cost semantics, and the edge cases in `saveIdea` transactions.
- **Security:** auth on every action and route, uploads, login throttle, cookie flags.
- **Tests:** what is untested (`queries.ts` dimensions, `mistakeSummary`, validation, actions). Should there be a Playwright smoke test?
- **UX consistency:** empty states, "—" vs 0. The app is desktop only, so don't ask for mobile work.

Output: a prioritized list (P0/P1/P2) with file:line references and a concrete suggestion per item, plus a short "tips" section.

### ☑ Step 3b: Full test coverage (done 2026-10-03; run after Step 4 at Shayan's request)
**Workflow checklist:**
- [x] 1 Scope: this section.
- [x] 2 Built with Shayan's lazy-developer skill (two parallel test-only agents: unit/component coverage, Playwright e2e).
- [x] 3a Code review: no P0, 2 P1 checks (both verified: thresholds fail when raised; the e2e secrets differ from `.env.local`), 13 P2.
- [—] 3b Product review skipped: no product change (only two accessibility labels in the type editor).
- [x] 4 Triage (below).
- [x] 5 `npm run check` green (lint, typecheck, `test:coverage` with enforced thresholds, build): 343 tests, 100% lines and branches across the scoped files. `npm run e2e`: 17 passed (32 s on an idle machine).
- [x] 6 Docs: `docs/testing.md`, `docs/e2e.md`, AGENTS (index, commands, test list).
- [x] 7 No UI change besides the labels; covered by the e2e settings test.
- [x] 8 Committed: `46e36f1`.

**What was done:**
- `vitest.config.mts` (renamed, CJS warning gone) enforces 100% lines/branches on pure logic, 90% on server logic and API routes, 80% overall; `src/proxy.ts` is included. Components are out of scope until they reach 80% (about 41% now; the e2e run covers them).
- 5 `v8 ignore` comments, each justified in `docs/testing.md` (drop the `seed.ts` one when `SEED_VERSION` passes 4).
- Playwright e2e (17 tests, desktop Chrome via `channel: "chrome"`, port 3300, build dir `.next-e2e`, temp data dir, throwaway secrets). `next.config.ts` gained `distDir: process.env.NEXT_DIST_DIR || ".next"` so the e2e build never overwrites `.next` (your 3100 and 3200 instances); default unchanged.
- `npm run check` = lint + typecheck + coverage + build. `npm run e2e` is separate (needs the system Chrome).
- Fixed two accessibility gaps the e2e found: the type editor's Name/Description labels and its icon-only Save/Cancel buttons.

**Review triage:** applied `proxy.ts` coverage, doc fixes, threshold proof, secrets check. Deferred (Backlog): `functions: 100` on the pure group, the stronger `metrics.test.ts`, `tempDb()` cleanup of temp dirs, e2e specs depending on each other's data (run the whole suite, not one file), scoping a few e2e locators, explicit env keys for the e2e server, one shared path constant for the e2e data dir, a Chrome note for future CI.

**Original plan:**
Goal: every behaviour is covered by tests, so Step 4 can refactor without fear. Currently there are 41 unit tests, covering only `stats`, `price` and `tz`.

**1. Tooling:**
- Add `@vitest/coverage-v8`, with `npm run test:coverage`.
- Set up a test DB helper: a temp `DATA_DIR` per test file, with a fresh migrated and seeded SQLite DB. Stub or mock `server-only` and `next/cache` (`revalidatePath`) in the Vitest setup.
- For auth inside actions, mock `requireAuth`, or set a signed cookie through a mocked `next/headers`.

**2. Coverage targets**, enforced in `vitest.config.mts` thresholds:
- **100%** lines and branches for pure logic: `src/lib/{stats,price,tz,format,validation,editor-shape,metrics}.ts`.
- **≥ 90%** for server logic: `src/lib/{queries,actions,settings,auth,session}.ts`, `src/db/seed.ts` (all upgrade paths v1→v4), and the API routes (`api/uploads`, `api/uploads/[name]`, `api/export` csv/json/db, `api/health`), which are tested by calling the route handlers directly.
- **≥ 80% overall.**

**3. What to test** (minimum):
- **`queries`:**
  - `loadIdeas` joins and R calculations, including `not_filled`;
  - `applyFilters` for every filter, including `open=1` and the UTC date range;
  - every `DIMENSIONS` key and tag-group dimension;
  - `scenarioComparisons`, `observationStats`, `mistakeSummary` (manual vs linked cost).
- **`actions`:**
  - `saveIdea` create and update: the scenario upsert/delete diff, tag replace, the attachment diff with file deletion, mistakes linked by index, deleted setup or type falls back to null;
  - delete idea removes its files;
  - setup, tag, tag-group, scenario-type and mistake-type CRUD, including uniqueness clashes;
  - `saveSettings` validation.
- **Validation:** every superRefine rule (stop side, stop = entry, skip reason, observation-only, outcome-only-for-forward-test, closed before opened, mistake → primary rejected).
- **Seed:** a fresh DB gets the expected setups, tags, types, mistake types and `seedVersion=4`. A v1 DB that has Mistake tags converts correctly and drops the timezone key.
- **Auth:**
  - `safeNext` (including the `/\host` case);
  - throttle lock and reset;
  - session sign and verify, expiry, wrong secret;
  - `proxy.ts` redirects and its 401 for `/api`.
- **Components:** React Testing Library + jsdom for the key client logic:
  - **Idea editor:** live R / R:R, price echo, quick exits, auto close time, Not filled, observation mode, mistake auto-cost, double-submit guard, unsaved-changes guard.
  - **TypePicker:** pick, create, existing-name reuse.
  - **TagManager:** add, move group, rename group, delete group.
  - **FilterBar:** Clear removes everything.

**4. E2E with Playwright** (desktop Chromium only). Run against a production build with a throwaway `DATA_DIR`, and seed via the UI. Cover:
- login (wrong / right / throttled);
- creating a taken trade with an alternative, a linked mistake and a pasted screenshot;
- a skipped idea and a hit/miss forward test;
- checking the dashboard KPIs against hand-calculated numbers;
- analytics group-by and the alternatives and skips tabs;
- Settings tag and type management;
- CSV export contents;
- logout.

Add `npm run e2e`.

**5. Wire it up:**
- `npm test` runs unit + component tests, `npm run e2e` runs Playwright, and `npm run check` runs lint, typecheck, `test:coverage` and build.
- Add these to the CI workflow if Step 0 created a remote.
- Update the `AGENTS.md` definition of done: new code needs tests, and the thresholds must hold.

**Done when:**
- The thresholds pass.
- Playwright passes headless.
- The coverage report is linked in this file.
- Coverage gaps that are hard to reach are listed with a reason.

### ☑ Step 4: Cleanup from the review (done 2026-10-03; run before Step 3b at Shayan's request)
**Order change (Shayan, 2026-10-02):** Step 4 runs now, with its tests written as part of each fix; Step 3b (the rest of the coverage targets and Playwright) follows. Test tooling is already installed (vitest config, `test/db.ts` temp-DB helper, RTL, jsdom, coverage-v8, Playwright).

**Triage of docs/review-2026-10-02.md** (Shayan said to apply the review):
- **Apply (work package 1, data layer):** P0-1, P0-2, P1-1, P1-2, P1-3, P1-4, P1-10, P2-3.
- **Apply (work package 2, auth/actions/routes):** P1-11, P1-12, P2-6 (target side + exit coherence), P2-7, P2-9, P2-16, security headers, `safeNext` / throttle / `sniff` / `csvCell` moved into `src/lib` with tests.
- **Apply (work package 3, UI):** P1-5, P1-8, P1-9, P2-1, P2-2, P2-4, P2-10, the "—" vs 0 fixes, empty states, destructive-action errors, explicit Cancel target, P2-14 (formatter cache).
- **Defaults I chose where the review left a product call** (change them if you disagree):
  - Mistake overlap rule: a trade's total counts each linked alternative's delta once, plus manual costs; per-type rows show each mistake's own delta.
  - Closing a trade no longer stamps `closedAt = now`; it defaults to the opened time.
- **Defer (Backlog):** P1-7 and the e2e run (Step 3b), P2-5 (comment only, done inline), P2-8 warnings, P2-11 checklist keyed by text, P2-12 one date concept, P2-13 mixed-status badge, P2-15 journal paging, login-throttle redesign, session versioning, markdown image policy, `__Host-` cookie, read-path auth asserts, upload streaming cap.


**Workflow checklist:**
- [x] 1 Scope: the triage above.
- [x] 2 Built with Shayan's lazy-developer skill in three work packages (data layer; auth/actions/routes; UI and editor split).
- [x] 3a Code review: no P0; 1 P1, 11 P2.
- [x] 3b Product review (code only, the reviewer could not log in): no P0; 4 P1, 8 P2.
- [x] 4 Triage (below), fixes applied.
- [x] 5 typecheck, lint, 283 tests (41 before) and build green. The e2e run is still Step 3b.
- [x] 6 Docs: AGENTS, architecture, data-model, product, README, `.env.example`, CHANGELOG.
- [x] 7 Browser (dashboard, trade page, editor, analytics skips): renders correctly, signed mistake costs and "not measured" rows show. Not clicked: saving, the Hit/Miss confirm, the `(shared)` / closed-time hints.
- [x] 8 Committed: `b5b57ac` (data layer) and `055a4c9`.

**What was done:** every item in the Step 4 triage above (P0-1, P0-2, P1-1 to P1-5, P1-8 to P1-12, plus the cheap P2s). Highlights: mistake cost is signed and overlap-aware; indexes (migration `0003`, restart the dev server after applying); `queries.ts` split from the pure `analytics.ts`; one `status.ts`; the editor shell went from 1107 to 268 lines; fail-closed session secret; security headers; a missing close time defaults to the open time.

**Review triage (second round):**
- **Applied:** missing-`SESSION_SECRET` login error; spurious dirty flag; `closedAtAuto` restored on load; numeric fields in the editor (risk %, fees, P&L) no longer silently discarded; one cost notation in the editor and on pages; cost-sign hint; shortened dashboard copy and "not measured" rows; "(shared)" tag on overlapping mistakes; closed-time hint on the trade page; client/server error labels; the Hit/Miss confirm names what is removed; red drawdown only when above 0; dead code; test helper renamed to `tempDb`; brittle test assertions; CHANGELOG and data-model tidy.
- **Deferred (Backlog):** the "No tag" row can't be filtered yet; login throttle uses the leftmost `X-Forwarded-For` (README says the proxy must overwrite it); escalating locks, session versioning and read-path auth asserts; P2-8, P2-11, P2-12, P2-13, P2-15.
- **Checked:** the 12 imported backtest trades all pass the new validation rules.
- **Notes for Shayan:** switching to Hit/Miss now really deletes the scenarios (after a confirm). Old ideas with a wrong-side target can't be re-saved until fixed.

**Original plan:**
- Triage the review with Shayan, then do the agreed P0/P1 items.
- Candidates already known:
  - Split `idea-editor.tsx` into `ScenarioCard`, `MistakesCard`, `ScreenshotsCard`, `DateTimeField` and a basics card.
  - Split the analytics tabs into components.
  - Add a shared `GroupList` / `BreakdownCard` component.
  - Add one `filterByStatus` / `liveOnly` helper.
  - Add DB indexes (migration).
  - Make prev/next a cheap ordered-id query.
  - A cleanup job or Settings button for orphaned uploads.
  - Reset `.data-dev` (it's full of QA junk data).
  - Delete the unused Next scaffold SVGs in `public/`.
  - Unit tests for queries, validation and mistake costs.
- **Done when:** the agreed items are done, behavior is unchanged, and everything is green.

### ☑ Step 5: Better dropdown component (done 2026-10-03)
**In one line:** the plain browser dropdowns are replaced by one styled dropdown you can search by typing and use from the keyboard.

**Workflow checklist:**
- [x] 1 Scope: below.
- [x] 2 Built with Shayan's lazy-developer skill. Rung 5 (installed dependency): nothing suitable was in `node_modules`, so `@radix-ui/react-popover` 1.1.23 and `cmdk` 1.1.1 were added (the plan's recommendation). One `Select` keeps the old `<select>` API, so call sites barely changed.
- [x] 3a Code review: no P0; 4 P1 (missing Select unit tests, selected option not exposed to screen readers, search matching the hidden index, ARIA wiring), 10 P2.
- [x] 3b Product review (code only; the reviewer's browser was blocked): no P0; 3 P1 (Tab in the open list, typing on the closed trigger, digits in search), 7 P2.
- [x] 4 Triage: all P1 and the cheap P2 applied (see below).
- [x] 5 `npm run check` green (362 tests, 26 files; 19 new in `src/components/ui/select.test.tsx`); `npm run e2e` 17/17.
- [x] 6 Docs: AGENTS, architecture (Dropdowns), testing, CHANGELOG.
- [x] 7 Browser (1280 px): setup dropdown opens by mouse, shows Live / Testing groups, search filters ("ins" leaves two setups), Enter picks, no console errors.
- [x] 8 Committed: `5d7fd97`.

**Notes:**
- The first builder reported a `select.test.tsx` that did not exist; the review caught it and the tests were then written. Always check claimed tests exist.
- Behaviour: lists over 8 options get a search box; with 8 or fewer, typing still jumps to a match. Tab closes the list and returns focus to the trigger. Typing on a closed trigger opens it. Active filters in the filter bar get an accent. The empty option ("All setups") shows no check mark. The popover flips before sliding under the Save bar.
- Not done: the Analytics "Group by" / "Chart" selects have no active accent (they always have a value). Popover flip and collision are Radix behaviour and untested in jsdom. `npm audit` reports vulnerabilities in the tree (not investigated).

**Original plan:**
- Replace the native `<select>` (styled `Select` in `src/components/ui.tsx`) with a custom component in `src/components/ui/select.tsx` (or similar). It needs:
  - a styled trigger and a popover list;
  - option groups (setups by status, tags by group);
  - search for long lists (setups, scenario/mistake types, tags);
  - full keyboard support (arrows, Enter, Esc, type-ahead);
  - ARIA combobox / listbox roles;
  - correct popover positioning (flip and collision handling inside the desktop viewport).
- **Recommendation:** `@radix-ui/react-popover`, plus `cmdk` for the searchable list. Both are small, accessible and headless, and can be styled with our tokens. Only build from scratch if Shayan prefers no new dependencies; the npm network is flaky, so use retries.
- **Use it in:**
  - the idea editor (setup, TF, bias, market, exit reason, alternative type, mistake link);
  - `TypePicker` ("All saved types…");
  - the filter bar;
  - analytics controls;
  - settings (tag group);
  - the setup editor (default TF).
- **Done when:** no plain `<select>` is left in the app UI; it works with keyboard only.

### ☑ Step 6: Better date & time picker (done 2026-10-03)
**In one line:** the plain date and time boxes are replaced by a calendar popup (in UTC) with Now/Clear and range presets for the journal filter.

**Workflow checklist:**
- [x] 1 Scope: below.
- [x] 2 Built with Shayan's lazy-developer skill. Rung 7 (custom code), no new dependency: `react-day-picker` needs `@date-fns/tz` to be UTC and its "today" is hard to pin in tests; a Monday-first grid on the existing Radix Popover is about 100 lines of UTC string maths. Pure helpers in `src/lib/date-input.ts` (100% covered, in the `pure` group); UI in `src/components/ui/date-picker.tsx` (Calendar, DateTimeField, DateRangePicker).
- [x] 3a Code review: no P0; 2 P1 (stale range anchor, Cmd+Enter saving stale state), 12 P2.
- [x] 3b Product review (live UI): no P0; 4 P1 (no "same as opened" shortcut, errors on every keystroke, date-only typing rejected, range needed Done), 9 P2.
- [x] 4 Triage: all P1 and the cheap P2 applied (see below).
- [x] 5 `npm run check` green (452 tests in 29 files, was 362/26); `npm run e2e` 18/18.
- [x] 6 Docs: AGENTS, architecture, testing, e2e, CHANGELOG.
- [x] 7 Browser (1280 px): journal "Any date" popover (presets, From/To, UTC today highlighted), editor Closed popover (Now, Same as opened, Done; time seeded from Opened). Also found and fixed a Step 5 regression: the filter-bar dropdowns each took a full row (now `size="sm"` is `w-auto`).
- [x] 8 Committed: `6457db2`.

**Notes:**
- Closed field: "Same as opened"; an empty Closed calendar opens on the Opened month and a day pick takes Opened's time. Typed entry accepts a full value, a date alone, a time alone, or a pasted ISO string; the format error shows on blur. Save is blocked while Opened/Closed hold invalid text. A range pick closes on the end click; presets are Today, Yesterday, This week (Mon to today), Last 7 days, Last 30 days, This month. Invalid or inverted `from`/`to` in the URL are normalised server-side.
- Backlog (not built): per-chip clear, preset label wording, tab order of the calendar buttons, hiding trailing week rows, `emptyIdea()` reading the clock at render (possible SSR/client minute mismatch).

**Original plan:**
- A UTC date-time picker with:
  - a popover calendar (month navigation, today, a clear month/year header);
  - a time input (HH:mm, 24h);
  - "Now" and "Clear" buttons;
  - a date-range mode for the journal and analytics filters (`from` / `to`), plus presets: Today, This week, Last 30 days, This month.
- **Recommendation:** `react-day-picker` (v9, accessible), styled with our tokens. It does all the date maths in UTC, so it's consistent with Step 1.
- **Replace:**
  - `DateTimeField` in the idea editor;
  - the `<input type="date">` pair in `src/components/filter-bar.tsx`.
- **Done when:** no native datetime or date inputs remain; a typed or picked time round-trips exactly (UTC).

### ☑ Step 7: Balance simulator (done 2026-10-03)
**In one line:** a what-if calculator that shows what your trades would have turned a starting balance into (balance curve, drawdown, per-trade table), on a new Analytics tab plus a dashboard row.

**Workflow checklist:**
- [x] 1 Scope: below.
- [x] 2 Built with Shayan's lazy-developer skill. Rung 5 for the chart (existing Recharts `EquityChart` with `money`/`base` props), rung 2 for the tab, filters, KPI tiles and form primitives, rung 7 for the math (one pure `simulateBalance` in `stats.ts`) and the URL-param parser (`src/lib/balance.ts`, in the `pure` group); inputs are remembered in localStorage (`balance-store.ts`).
- [x] 3a Code review: no P0; 3 P1 (e2e time bomb on the real clock, `1,000` parsed as 1, dashboard card scope), 9 P2. The core math was verified by hand.
- [x] 3b Product review (live UI): one trust bug (the Analytics subtitle said "Everything is in R" on the $ tab), 5 P1, 9 P2.
- [x] 4 Triage: all P0/P1 and the cheap P2 applied (see below).
- [x] 5 `npm run check` green (501 tests in 32 files, was 452/29); `npm run e2e` 19/19.
- [x] 6 Docs: product, data-model, architecture, README, AGENTS, testing, e2e, CHANGELOG.
- [x] 7 Browser (1280 px): Balance tab (form, hypothetical note, n<20 warning, KPI tiles incl. R total, curve), dashboard "Balance sim" row. Hand check: 12 taken trades, +14.05R, 1% compounding → $1,000 → $1,148.14 (+14.81%).
- [x] 8 Committed: `3776a53`.

**Notes:**
- Rules: risk is in percent (1 = 1%); compounding uses the current balance, fixed uses the starting balance; a fee is charged on every trade including breakevens; ruin clamps the balance to 0 and later trades are not simulated; a recorded risk of 0 counts as missing; a Settings default risk of 0 or less is treated as 1%; numbers are parsed with `parsePrice` (`1,000` works).
- Always labelled hypothetical; non-taken statuses show a "Not live results" banner (and "Mixed statuses" when combined with taken); the n<20 warning shows.
- The dashboard row is all-time taken trades and ignores the 7D/30D selector (it says so); it uses your last simulator settings.
- Backlog: max drawdown in R, a per-month table, a loading skeleton.

**Original plan:**
 ("how much would I have made?")
- **Inputs:**
  - starting balance (e.g. $1,000);
  - risk per trade, either the default % from Settings or each trade's recorded `risk_pct`;
  - mode: **compounding** (risk % of the current balance) or **fixed** (risk % of the starting balance).
  - Optional: fees per trade.
- **Scope:** uses the normal filters, so it works for all taken trades, one setup, one coin, a date range, or backtest/forward-test statuses ("what if I'd taken my skips?").
- **Output:**
  - ending balance, $ P/L and % return;
  - max drawdown in $ and %;
  - largest win and loss in $;
  - a balance equity curve in $;
  - a per-trade table (date, setup, R, $ P/L, balance after).
- **Where:**
  - Analytics gets a new tab, "Balance".
  - The dashboard gets a compact card ("$1,000 → $1,240, +24%") with a link.
  - The setup page gets a "Simulate" link.
  - Inputs live in URL params, remembered in localStorage.
- **Math:** add `simulateBalance(points, { start, riskPct, mode, useTradeRisk })` as a pure function in `src/lib/stats.ts`, with unit tests (compounding vs fixed, losing streaks, zero trades). For each trade, `pnl = base × riskPct × R`, where `base` is the current balance when compounding or the starting balance when fixed.
- **Done when:** the numbers match a hand calculation on a known set (e.g. +2R, −1R, +3R at 1% on $1,000, both modes); it works with filters; it's linked from the dashboard and setup pages.

## Backlog (not scheduled)
- Balance simulator extras: max drawdown in R, a per-month table, a loading skeleton for the Run button.
- Date picker polish from the Step 6 reviews: per-chip clear, preset wording, calendar-button tab order, trailing week rows, `emptyIdea()` clock at render.
- Test polish from the Step 3b review: `functions: 100` on the pure group, a stronger `metrics.test.ts`, `tempDb()` cleanup, make e2e specs independent (setup project), scope a few e2e locators, explicit env keys in the e2e web server, one shared e2e data-dir constant.
- Filter by "No tag" in the filter bar (the analytics "No tag" rows have no matching filter).
- Login throttle: take the rightmost `X-Forwarded-For`, escalating locks, size cap; session versioning for logout-everywhere; auth assert in `loadIdeas`.
- Deferred review items: P2-8 (warnings for dropped setup/type), P2-11 (checklist keyed by text), P2-12 (one date concept), P2-13 (mixed-status badge), P2-15 (journal paging).
- Delete the empty `src/components/ui/` directory if it still exists.
- The journal table clips its last columns (Entry / R:R / R / Alts) at a 1024 px window because the wrapper is `overflow-hidden`. Consider `overflow-x-auto` or fewer columns (from the Step 2b browser check).
- Show an error if deleting an idea fails. Right now `idea-actions.tsx` always redirects (from the Step 2 product review).
- **Git tooling** (from the Step 0 review):
  - a `.githooks/pre-commit` blocking staged `.env*` and `*.db*` (or `gitleaks`);
  - `.gitattributes` (`package-lock.json -diff`, `drizzle/meta/*.json linguist-generated`);
  - per-step branches with `--ff-only` merges;
  - before any public push: remove the absolute paths and personal profile details from the docs.
- A CSV/JSON **import** for backtests and other journals.
- An "entry options considered" field.
- An explicit "Early TP (allowed exception)" exit.
- Per-KPI greying when the sample is small.
- Backtest the hammer + thrust setup on 1–2 years per coin: `fetch-1h.py --start …` then `backtest-hammer-thrust.py --from … --to …`.
