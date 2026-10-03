# End-to-end tests (Playwright)

`npm run e2e` drives the real production build in a real browser, through the UI only. Desktop only (1280x800, Chromium).

## How it runs
- **Browser:** the system Google Chrome (`channel: "chrome"`), headless. No `playwright install` and no browser download.
- **Server (`playwright.config.ts` → `webServer`):** `npm run build && next start -p 3300`, with:
  - `NEXT_DIST_DIR=.next-e2e`, so the build never touches `.next/dev` (the 3100 dev server) or `.next/standalone` (the 3200 backtest instance);
  - `DATA_DIR` = `$TMPDIR/edge-journal-e2e-3300`, wiped before the build and removed again by `e2e/global-teardown.ts`;
  - throwaway `APP_PASSWORD` / `SESSION_SECRET` from `e2e/env.ts` (not your real ones; `.env.local` is overridden), `COOKIE_SECURE=false`, `NODE_ENV=production`.
- Port **3300** is reserved for this. It fails if something already listens there (`reuseExistingServer: false`).
- One worker, no retries. A full run takes about 1.5 minutes (roughly 1 minute is the build, the 18 tests take about 40 s).
- Needs Node 22 on `PATH` (see AGENTS.md).

## Layout
| File | Covers |
|---|---|
| `e2e/env.ts` | Port, base URL, throwaway secrets |
| `e2e/helpers.ts` | `test` (fails on any console error or page error), `authed` (logged-in page), editor helpers, `kpi()`, `chooseOption()`, `setDateTime()` |
| `01-login.spec.ts` | Wrong password, 5-failure lock (own fake client IP), right password, `?next=` kept, off-site `?next=` ignored |
| `02-trades.spec.ts` | Taken BTC trade (-1R) with a BE stop alternative, an inline-created mistake measured against it (-1.00R), a screenshot upload; a winning ETH trade (+3R) with typed / picked UTC open and close times |
| `03-skip-forward.spec.ts` | Skipped idea with a skip-reason tag, Hit and Miss forward tests with no prices |
| `04-dashboard-analytics.spec.ts` | Dashboard KPIs against hand-calculated numbers, group-by, alternatives tab, skips tab, date-range filter (typed, preset, Clear) |
| `05-settings-export-logout.spec.ts` | Tag and mistake-type add / rename / delete, CSV export, sign out |

## Rules
- **The specs run in file order and later ones depend on earlier data** (they share one DB). `02` and `03` seed it, `04` and `05` read it. Do not run a single later file on its own.
- Dashboard numbers: 2 closed taken trades (-1R, +3R) → win rate 50%, expectancy +1.00R, total +2.00R. The skipped and forward ideas must not change them. If you add a taken trade to a spec, update `04`.
- The login throttle is keyed on `x-forwarded-for`; a spec that fails logins sets its own fake IP (`extraHTTPHeaders`) so it can't lock out the others (all normal logins share the key `local`).
- Prefer role / label locators. A few places use workarounds because the UI lacks accessible names (see the comments in `05`).
- Failures leave a trace in `test-results/` (gitignored): `npx playwright show-trace <trace.zip>`.
