# Changelog

All notable changes are recorded here, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow [SemVer](https://semver.org/).

> **About the history before v0.1.0.** The app was built (2026-10-02, sessions 1–4) before a git repository existed. The commits up to the `v0.1.0` tag are **milestone commits reconstructed from the final state**: the files were grouped by area in dependency order, so `git log` tells the story. Commit timestamps are the time of the reconstruction, not when the work was done. Intermediate commits may not build on their own. `v0.1.0` and every commit after it build and pass the checks. From v0.1.0 on, every plan step and change follows [docs/workflow.md](docs/workflow.md) and gets its own commit(s).

## [Unreleased]
### Added
- Git hooks (`.githooks/`, install with `npm run hooks`): pre-commit runs lint, typecheck and the unit tests; pre-push runs the full check, build and e2e. `npm run verify` runs the full gate by hand and records the verified commit so the push hook passes instantly. Tested in `src/git-hooks.test.ts`.

### Changed
- `tsconfig.json` is committed in the format Next rewrites it to, so a build no longer leaves the working tree dirty.


## [0.2.0] - 2026-10-03
**Upgrading:** this release invalidates all existing sessions once (the session signing key now also depends on `APP_PASSWORD`), so everyone logs in again. Migration `0003` is additive and runs automatically; the app first writes a `pre-migrate-*.db` copy.

### Added
- **Balance simulator (Step 7).** Analytics → Balance tab, a dashboard card ("$1,000 → $1,240, +24%", taken only, last-used inputs) and a "Simulate" link on setup pages. Starting balance, risk % (Settings default or each trade's own `risk_pct`), compounding or fixed, optional fee per trade; ending balance, P/L and return, max drawdown ($ and %), largest win / loss, a $ balance curve and a per-trade table. Always labelled hypothetical, shows the n < 20 warning, marks non-taken statuses as not live, validates inputs inline (numbers parse like prices; a recorded risk of 0 counts as missing). Pure `simulateBalance()` in `stats.ts` and `src/lib/balance.ts`; inputs in the URL, remembered in localStorage.
- **UTC calendar pickers (Step 6)** replace every native date input: `DateTimeField` (typed `YYYY-MM-DD HH:mm`, a date or time alone, or a pasted ISO string; or a popover with month grid, 24h time box, Now, Clear, "Same as opened") in the idea editor, and one date-range popover in the filter bar (typed From / To, presets Today / Yesterday / This week / Last 7 / Last 30 days / This month). Custom UTC grid on the existing Radix Popover, no new dependency; full keyboard support. Invalid typed text is never saved and blocks Save with a message naming the field. Date maths in `src/lib/date-input.ts`.
- **One custom `Select` (Step 5)** replaces every native `<select>`: Radix Popover + cmdk, option groups, search above 8 options, type-ahead, full keyboard and screen-reader support. New dependencies `@radix-ui/react-popover` and `cmdk`.
- **SSH / no-Docker deployment.** `scripts/server.sh` (`npm run server -- <command>`) deploys and operates the app on your own Debian/Ubuntu (systemd) server over SSH; no Docker, registry or remote repo. `doctor` (read-only report with exact fixes), `init` (idempotent: packages, optional Node / swap, locked `edge-journal` user, 0700 data and backup dirs, hardened systemd unit, daily 03:00 backup timer; the app password is typed hidden on the laptop and `SESSION_SECRET` generated there, both sent over ssh stdin into a root-only 0600 env file that a re-run never changes unless `--reset-password` / `--rotate-secret`), `deploy` (refuses a dirty tree, local typecheck + tests, `git archive HEAD`, build on the server), `status`, `logs`, `health`, `tunnel`, `backup`, `pull-backups` (off-site copy verified with `sqlite3`), `restore` and `rollback`. Config in `.deploy.env` (gitignored; template `deploy/deploy.env.example`).
- **Server side (`deploy/`).** `remote-deploy.sh` builds as the service user in a new release dir with a throwaway `DATA_DIR`, takes a verified pre-deploy backup (aborts on failure), swaps the `current` symlink atomically, waits for `/api/health`, and on failure switches back to the previous release (restoring the pre-deploy backup only if the old code refuses the migrated DB); keeps 2 releases. Data lives outside the release folders and nothing is ever deleted. Plus `remote-admin.sh`, `server-setup.sh`, `doctor.sh`, `lib.sh` and the systemd units.
- **`scripts/restore.sh <backup.db> [uploads.tar.gz]`** (see Fixed for what it guarantees) and `BACKUP_KEEP` for `backup.sh` (default 30; pre-deploy backups keep 10).
- **`/api/health`** checks the database (`select 1`) and that `DATA_DIR` / `uploads` are writable: 200 `{ok:true}` or 503 `{ok:false}`, no details. `src/instrumentation.ts` logs `FATAL:` lines at boot for an unwritable data dir, a missing or short `SESSION_SECRET` and a missing or `change-me` `APP_PASSWORD`.
- Friendly `error.tsx`, `global-error.tsx` and `not-found.tsx` (digest + Try again, no stack).
- Migration `0003`: indexes on foreign keys (`scenarios`, `idea_mistakes`, `attachments`, `idea_tags.tag_id`, `ideas.setup_id`).
- Warning before changing the Setup would clear ticked checklist items; confirmation before Hit / Miss drops scenarios that have prices (it says how many); empty states for Analytics, Setups ("Create your first setup") and a dashboard range with no closed trades.
- Docs: `docs/deployment.md` (owner's guide, data-safety invariants I1-I9), `docs/launch-audit-2026-10-03.md`; README leads with the SSH deploy path, keeps Docker as an alternative, and has Caddy / nginx snippets and backup / restore / update / rollback / move-server runbooks.
- Tests (final totals): 723 tests in 44 files (99.8 % line coverage) plus 19 e2e tests; `npm run check` and `npm run e2e` pass. Component tests (React Testing Library) for the editor, pickers, `Select`, filter bar, balance simulator, tables and error pages; `src/deploy-scripts.test.ts` (about 90 s) simulates first deploy, backup before swap, automatic rollback with a byte-identical data dir, the "newer DB" path, lock, pruning, restore and `server-setup.sh` through stub `ssh` / `scp` / `sudo`.

### Changed
- **Closing time:** entering an exit no longer stamps the close time with "now"; a blank "Closed" defaults to the open time, labelled so you can adjust it ("Still open" clears it).
- **Idea editor** split into a ~270-line shell plus cards in `src/components/idea-editor/`; the save payload and the editor's rules are pure functions in `editor-shape.ts`. Hit / Miss mode is derived (a forward test with no scenarios) instead of stored.
- `src/lib/queries.ts` is DB reads only; filtering, dimensions and comparisons live in `src/lib/analytics.ts`, status grouping in `src/lib/status.ts`; pages no longer query the DB directly. The idea page runs one targeted query per view; `Intl.DateTimeFormat` instances are cached; label maps are typed on the enums; shared `BreakdownList` and `fmtProfitFactor` / `fmtDrawdown`; `safeNext` and the login throttle moved to `src/lib/login-guard.ts`, `sniff` to `image-sniff.ts`, `csvCell` to `csv.ts`.
- Server actions return `{ ok: false, error: "Session expired, …" }` instead of redirecting, so an expired session no longer discards an unsaved editor.
- **Validation:** `not_filled` clears the exit price, an exit price needs an exit reason, a target must be on the profit side; errors read `Primary · Target: must be above entry for a long`. These rules can block re-saving an old or imported idea that has a wrong-side target until it is fixed. A failed save marks the invalid field inline, scrolls to it and focuses it.
- Mistakes show the signed cost with "lost" / "saved" (positive = lost); the dashboard says "not measured" / "n of m measured"; the editor and server share one `mistakeCost()` rule.
- Settings → Export & backup labels the SQLite download "Database only (no screenshots)" and points to `scripts/backup.sh`.
- `backup.sh` hardened (see Fixed); `.dockerignore` / `.gitignore` exclude `.deploy.env`, and the image no longer receives `deploy/`.
- UI polish: new ideas start with the last used coin; the primary button is darker (`#5b5ef0`, white text 4.88:1); skipped / missed / forward results read "if taken"; equity and balance curves are linear, an exact zero is neutral, ungrouped values read "Not set", months are three letters, price boxes have accessible names; the journal table puts R after Status and scrolls sideways at 1024 px; the Scenarios card is full width.

### Fixed
- **Docker first deploy (launch blocker).** Docker creates the bind-mounted `./data` as root but the image ran as `node` (uid 1000), so every page failed with EACCES while the healthcheck stayed green. New `scripts/docker-entrypoint.sh` creates `/data` + `/data/uploads`, `chown`s them and drops privileges with `setpriv`; `USER node` is gone from the Dockerfile; compose gains `no-new-privileges`. An explicit `user:` needs `chown 1000:1000 data`. Not run against real Docker.
- **Seed regression.** Deleting all setups and scenario types in the UI made the fresh seed run again on the next start and fail with `UNIQUE constraint failed` on every request. The fresh seed now needs `seedVersion` to be absent and the DB to hold no data; a DB with data but no marker goes through the upgrade path.
- **Migration safety.** `migrateSafely()` (`src/db/migrate.ts`): foreign keys OFF while migrating (a drop-and-recreate migration can't cascade-delete children), `foreign_key_check` in the same transaction as the migration (a violation rolls it back, the DB stays at the old version), a `VACUUM INTO` copy to `data/backups/pre-migrate-<ts>.db` (last 3) before pending migrations on a non-empty DB, and a refusal to start on a database newer than the code.
- **Backup / restore scripts.** `backup.sh`: `umask 077`, unique stamp, fails loudly when `journal.db` is missing, integrity-checks the copy, cleans temp files, retention works with spaces in paths on BSD and GNU. `restore.sh` validates first, keeps the replaced DB and its WAL as `journal.db.pre-restore-<timestamp>` (never overwriting an earlier copy), removes stale `-wal` / `-shm`, restores screenshots, re-checks integrity and refuses while the container runs.
- **Silent drops.** A price box holding text now blocks the save with a labelled error instead of silently saving a closed trade as open; the boxes keep what you type and flag "Not a number". A mistake cost, risk %, fee or P&L that is not a number does the same instead of sending NaN. An invalid Closed date blocks Save.
- **Saving an idea with a stale or foreign scenario id** (deleted in another tab, or belonging to another idea) no longer loses the scenario or fails on a foreign key; a mistake can never link to another idea's scenario.
- **Unsaved edits.** In-app links ask "Discard your unsaved changes?" while the editor is dirty; a successful save redirects with `router.replace`; Cancel goes to the idea or the journal. Browser Back is not intercepted.
- Hit / Miss: the row only appears once entry and stop are filled; switching an observation-only forward test to another status brings back a primary scenario; the Prices tab says what to do instead of saving nothing.
- A rejected screenshot upload shows the server's message (`role="alert"`); deleting an idea, setup or saved type shows the error when it fails.
- Dashboard and analytics: no more `−-1.00R`; the Open trades count matches its link; a real zero max drawdown shows `0.00R`; "2 of 3 taken trades had a mistake (incl. 1 open)"; ungrouped tags appear under "No tag"; "Skip reason" tag group can't be renamed or deleted; `?status=` rejects prototype keys.
- Login returns an error instead of throwing when `SESSION_SECRET` is missing or too short.
- Keyboard and layout: Cmd/Ctrl+Enter inside a picker no longer activates the focused button before the editor saves; the "n" shortcut ignores keys inside dialogs; the 1024 px layout no longer clips table columns or the Scenarios table.

### Security
- **Sessions fail closed:** the public fallback secret is used only when `NODE_ENV === "development"`; `COOKIE_SECURE` only disables `Secure` when exactly `false`; the JWT algorithm is pinned and `exp` is required. The signing key now includes `APP_PASSWORD`, so changing the password or `SESSION_SECRET` logs everyone out (this is the one-time session invalidation above).
- **Login limiter that cannot lock the owner out.** Password checks run one at a time through a small queue, so at most about 6 guesses a minute reach the password check whatever the headers or parallelism; extra parallel attempts are turned away unchecked. The owner is only ever slowed, never locked out. The per-client throttle keys on the last `X-Forwarded-For` entry and is size-capped.
- **Default password refused:** login is refused, with a message, while `APP_PASSWORD` is unset or still `change-me` (case-insensitive); the same is logged as `FATAL:` at boot.
- **`safeNext` open-redirect fix:** `?next=` values such as `/.//evil` that normalise to `//host` are rejected, and the query string is kept.
- **Headers and CSP** (`next.config.ts`): `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `Referrer-Policy: same-origin`, `nosniff`, `Permissions-Policy`, `img-src 'self' data: blob:` (remote markdown images no longer load); uploads keep exactly one, sandboxed CSP; `no-store` on `/api/export`; `X-Powered-By` removed. `outputFileTracingExcludes` keeps sources and docs out of `.next/standalone`.
- New attachments must exist in the uploads dir and not belong to another idea; the `db` export is staged in a private 0600 temp dir; uploads are checked by content and chunked bodies are byte-counted.
- Docker hardening: privileges dropped by the entrypoint, `no-new-privileges`; the SSH deployment runs as a locked system user under a hardened systemd unit and keeps secrets out of argv.

### Removed
- Mobile support: the bottom nav bar, the mobile card list, the editor's mobile reordering and all `sm:` / `md:` / `lg:` fallbacks. The app shell has a 1024 px minimum width.
- The "Duplicate" button on the trade page and its server action.
- Unused create-next-app SVGs in `public/` and the `::-webkit-calendar-picker-indicator` CSS.

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
