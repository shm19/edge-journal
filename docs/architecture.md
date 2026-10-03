# Architecture

## Stack
Next.js 16 (App Router, server actions, Turbopack), React 19, TypeScript, Tailwind 4 (dark theme tokens in `src/app/globals.css`), SQLite through better-sqlite3 + Drizzle ORM, zod, jose (JWT session), Recharts, react-markdown. Single process, single user.

## Folder map
```
src/
  proxy.ts                 Auth gate for every route except /login, /api/health, /api/uploads (that route checks auth itself)
  instrumentation.ts       register(): logs FATAL config problems at boot (production, Node runtime only; never crashes)
  app/
    layout.tsx             Root HTML shell (system fonts, no external font fetch)
    error.tsx / global-error.tsx / not-found.tsx   Friendly failure pages (no stack, digest + Try again), via components/error-screen.tsx
    login/                 Login page + server actions (login/logout, throttle, safe ?next= redirect)
    (app)/                 Authenticated area. layout.tsx = requireAuth + sidebar (force-dynamic)
      page.tsx             Dashboard
      ideas/               Journal list, new, [id] detail, [id]/edit
      setups/              Playbook list, new, [id] detail, [id]/edit
      analytics/page.tsx   Tabs: breakdown | alternatives | skips | balance
      settings/page.tsx    General settings, tags & groups, scenario types, export (sign out is only in the sidebar)
    api/
      uploads/             POST image (magic-byte check, 10 MB); [name] GET serves it (auth, nosniff)
      export/              ?format=csv|json|db
      health/              Public readiness check: select 1 + DATA_DIR / UPLOAD_DIR writable; 200 {ok:true} or 503 {ok:false} (generic body)
  db/
    schema.ts              Drizzle tables + enums (status, exit reasons, …)
    index.ts               Lazy connection (WAL, FKs), runs migrations + seed on first use; logs FATAL and doesn't cache a failed open
    migrate.ts             migrateSafely(): newer-DB refusal, pre-migrate VACUUM INTO copy, FKs off during the migration + foreign_key_check
    seed.ts                First-run seed (only while `seedVersion` is absent and the DB is empty) + versioned additive upgrades (SEED_VERSION)
  lib/
    stats.ts               PURE: R math, summarize, groupSummaries, compareScenarios, skipAudit, simulateBalance, sessions (DST-aware)
    balance.ts             PURE: balance-simulator URL params (parseBalanceParams, balanceQuery, VIEW_KEYS)
    balance-store.ts       Client-only localStorage of the last inputs (guarded; useSyncExternalStore)
    queries.ts             Server (server-only): ALL DB reads. loadIdeas() → IdeaView (joins + computed R), targeted getIdea() (React cache()),
                           ideaNeighbours() (prev/next in SQL), getSetup, setupIdeaCount, usageCounts, lastSymbol, list* helpers
    analytics.ts           PURE (types-only import of queries): parseFilters/applyFilters, DIMENSIONS + dimensionKeys, rrBucket,
                           scenarioComparisons, observationStats, mistakeSummary, tagGroupNames
    status.ts              PURE: STATUS_BUCKETS (taken / skips / forward / backtest), inBuckets(), isOpen(). The only place that groups statuses
    actions.ts             "use server": all mutations (saveIdea, setups, tags, tag groups, scenario types, settings)
    validation.ts          zod schemas + human-readable errors
    settings.ts            getSettings() with defaults
    preflight.ts           preflightProblems(env, dataDir): data dir writable, SESSION_SECRET, APP_PASSWORD (used by instrumentation.ts)
    auth.ts / session.ts   Password check, JWT cookie (session.ts is edge-safe for proxy.ts)
    price.ts / tz.ts       Price parsing; APP_TIMEZONE = "UTC" + zone helpers (sessions) (shared client + server)
    editor-shape.ts        Editor form-state types + IdeaView → form mapping, plus the pure editor transitions (patchScenario, setStatus,
                           toObservation/toPriceMode, editorMistakeCost) and buildSavePayload (shared, unit-tested)
    format.ts              Formatting + label maps (fmtR, fmtCost, fmtProfitFactor, fmtDrawdown, cached Intl formatters)
    metrics.ts             Analytics metric list (shared)
  components/              ui.tsx primitives, bits.tsx domain bits, breakdown-list.tsx (shared n / win rate / R rows), charts (client), tables
    idea-editor.tsx        Editor shell (state, save, layout), ~270 lines
    idea-editor/           Its cards: context-card, checklist-card, tags-card, scenario-card (ScenarioCard/PriceInput/QuickExit),
                           notes-card, mistakes-card, screenshots-card + use-screenshot-upload (hook)
    type-picker.tsx, filter-bar.tsx, setup-editor.tsx, settings-forms.tsx   Other client editors
drizzle/                   SQL migrations (committed). Applied automatically at startup.
scripts/                   backup.sh, restore.sh, docker-entrypoint.sh + backtest pipeline (see docs/backtesting.md)
```

## Data flow
- **Reads.** Server components call `loadIdeas()` (`src/lib/queries.ts`), which loads all rows into memory, joins them and computes R per scenario. Pages then filter with `applyFilters(list, filters)` (`src/lib/analytics.ts`) and aggregate with `stats.ts`. Pages never touch `db` directly: add a function to `queries.ts` instead. Single-idea pages use `getIdea(id)`, which filters the child tables in SQL; prev/next uses `ideaNeighbours()`. `loadIdeas()` stays a full in-memory load for list and analytics pages (fine up to a few thousand ideas; not measured). No client-side data fetching.
- **Writes.** Client components call server actions in `src/lib/actions.ts`. Each action:
  1. runs `requireAuth()`;
  2. validates with zod;
  3. writes in a transaction;
  4. calls `revalidatePath("/", "layout")`.

  The client then calls `router.push` / `router.refresh`.
- **URL state.** Filters, group-by, metric, tab, range and the balance-simulator inputs (`start`, `risk`, `mode`, `trade`, `fee`; `VIEW_KEYS` in `balance.ts` are not filters) live in search params (`components/filter-bar.tsx`, `analytics-controls.tsx`). The filter bar reads `window.location.search` when updating, to avoid stale params.

## Server/client boundaries
- Files with `"use client"` export **components only** as far as the server is concerned. A constant exported from a client module becomes a client reference on the server, so `METRICS.find` breaks. Shared values go in plain `src/lib/*` modules.
- `src/db` and `src/lib/{queries,settings,auth}.ts` import `server-only`. `analytics.ts`, `status.ts` and `stats.ts` are pure (no DB), so they are unit-tested without a database; fixtures for them are in `test/fixtures.ts`.
- **Statuses are grouped only in `status.ts`.** Never compare `idea.status === "..."` in a page; use `inBuckets(list, "taken")` etc. A test fails if an `IDEA_STATUSES` value is in no bucket (or two).

## Auth
- `APP_PASSWORD` (env) is compared in constant time.
- Sessions are an HS256 JWT in the `ej_session` cookie, valid 30 days, signed with `SESSION_SECRET` (32+ characters). It **fails closed**: the public dev fallback secret is used only when `NODE_ENV === "development"`, otherwise signing/verifying throws.
- Cookie flags: `Secure` in production; only an explicit `COOKIE_SECURE=false` turns it off there (`cookieSecure()` in `session.ts`). In `next dev` it is off unless `COOKIE_SECURE=true`.
- Login throttle: 5 failures per client IP → 60 s lock, held in memory (`src/lib/login-guard.ts`, together with `safeNext`: `?next=` must be a same-origin relative path).
- **Server actions never `redirect()`.** `actions.ts` checks `isAuthenticated()` and returns `{ ok: false, error: "Session expired, …" }` so a half-written editor isn't thrown away. Pages and layouts still use `requireAuth()` (redirect).
- Testable helpers live outside `"use server"`/route files: `login-guard.ts`, `image-sniff.ts` (uploads), `csv.ts` (export).
- New attachments must exist in `UPLOAD_DIR` and not belong to any other attachment; `db` exports are staged in a private `mkdtemp` dir (0600).
- Security headers, all in `next.config.ts` (`headers()` entries merge per key, so each header has one source):
  - every route: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`; no `X-Powered-By`;
  - every route except `/api/uploads/*`: one CSP, `frame-ancestors 'none'; img-src 'self' data: blob:` (no remote images, so markdown `![](https://…)` can't leak the viewer's IP; `blob:` = pasted-screenshot previews, `data:` = the select chevron);
  - `/api/uploads/*`: its own CSP `default-src 'none'; sandbox` (the route sets the same value; the config entry makes it the only one sent) and the route's `Cache-Control: private, max-age=31536000, immutable` (names are random, so it is safe; `private` keeps shared caches out);
  - `/api/export/*`: `Cache-Control: no-store`.
  `src/next-config.test.ts` matches these sources the way Next does and checks exactly one CSP per path. HSTS belongs on the reverse proxy.
- Validation (`validation.ts`): `not_filled` clears the exit price, an exit price needs a reason, a target must be on the profit side; `firstError(err, input)` labels scenarios by `isPrimary`.

## Conventions
- **UI:**
  - Use the tokens: `bg-panel`, `border-line`, `text-muted`, `text-faint`, `text-win`, `text-loss`, `accent`.
  - Use the primitives from `components/ui.tsx`.
  - **Dropdowns:** always `Select` (`components/ui/select.tsx`, re-exported from `ui`), never a raw `<select>`. It keeps the native API (`<option>` / `<optgroup>` children, `value`, `onChange(e)` with `e.target.value`, `id`, `aria-label`, `disabled`, plus `size="sm"` and `name`), renders a `role=combobox` button and a cmdk listbox in a Radix Popover (flip and collision handling, outside click, focus returns to the trigger). Search (label only) shows above 8 options; shorter lists get type-ahead. A printable key on the closed trigger opens the list and seeds the query ("H1" works like a native select). Tab inside the list commits nothing: it closes the list and focus returns to the trigger. Cmd/Ctrl+Enter is ignored inside it so the editor save shortcut still works. `active` accents the trigger (used by the filter bar for non-empty filters). The popover keeps 72px of bottom collision padding so it flips before sliding under the sticky Save bar.
  - **Dates and times:** never a native `<input type="date">` / `datetime-local`. `DateTimeField` and `DateRangePicker` (`components/ui/date-picker.tsx`) are a text box (typed `YYYY-MM-DD HH:mm`, validated; invalid text stays with an inline error and is never committed) plus a Radix Popover holding the `Calendar`: a custom UTC month grid (`role=grid`, roving tab stop, arrows / Home / End / PageUp / PageDown / Enter / Esc, today has `aria-current="date"`, focus returns to the trigger). All maths is pure UTC string maths in `lib/date-input.ts` (no `Date` in the local zone; the pure helpers take "now" as a parameter, while the components read the clock through `todayUtc`, which the tests pin by faking `Date`). Navigation is clamped to years 1000-9999, `normalizeRange` is the one place a from/to pair is validated and ordered (picker, filter bar and `parseFilters`), and the text box also takes a date alone, a time alone or a pasted ISO string. Editor values stay `YYYY-MM-DDTHH:mm` (see `tz.ts`); filter params stay `YYYY-MM-DD`. We wrote the grid instead of adding `react-day-picker`, which would have needed a `timeZone` setting and its own "today" handling.
  - Empty values render "—", never 0. `Summary.totalR` is `null` for an empty sample; a real zero (e.g. max drawdown of an all-win sample) renders `0.00R`.
  - A tag group with no tag on an idea groups under "No tag" (`NO_TAG`), not "—".
  - Destructive actions check `res.ok` and show the error; they only navigate away on success.
- **Numbers:**
  - Show R with a sign and two decimals (`fmtR`).
  - Use `tabular` for numeric columns.
  - Use `fmtPrice` for prices.
- **Times:**
  - UTC only. Store ISO UTC strings.
  - `fmtDateTime` / `fmtDate` always format in UTC (`fmtDateTime` appends "UTC").
  - Editor inputs use `isoToZonedInput` / `zonedInputToIso`, which default to `APP_TIMEZONE`.
  - Don't add timezone parameters or settings back.
- **Desktop only:**
  - There is no mobile support (decided 2026-10-02). Don't add phone layouts or test at 375 px.
  - The app shell has `min-w-[1024px]`, so `sm:`/`md:`/`lg:` Tailwind prefixes are always on and must not be used; write the desktop value directly. `xl:` (1280px) is the only real breakpoint.
  - `/login` sits outside the app shell and stays responsive on purpose.
- **Idea editor save and navigation guards:**
  - `buildSavePayload` (pure) blocks any non-empty price box that does not parse (entry, stop, target, exit; per scenario, "Primary · Exit: must be a number") and returns the DOM id of the first bad field (`priceFieldId`, `SYMBOL_FIELD_ID`, `idea-opened`, `idea-closed`). Price boxes are not filtered while typing, so a typo stays visible. A forward test left on the Prices tab with no entry / stop is told to "switch to Hit / Miss (no prices)", and its "Did it play out?" row only shows once entry and stop are filled (`pricesReady`).
  - On a failed save (client or server error, mapped by `errorField`) the editor sets an inline message under that field (it disappears at the next edit), scrolls to it and focuses it, and keeps the summary in the save bar.
  - While dirty, a capture-phase click handler on `document` asks "Discard your unsaved changes?" before any same-origin link navigates (modified clicks, new tabs, external links and the current URL are left alone); `beforeunload` covers reload / close. Both stand down after a successful save, which redirects with `router.replace`. Browser Back inside the app is not intercepted (Next's router owns popstate).
- **Editor state:** the idea editor keeps one `EditorIdea` in state. Anything derivable is derived, not stored (`isObservationOnly` = forward test with no scenarios). Transitions that carry rules (closing time, status changes, dropping scenarios) are pure functions in `editor-shape.ts` and tested there; cards only render and call them.
- **Lint:** React-compiler rules apply. Use `useSyncExternalStore` for browser-only values, never `setState` inside an effect, and never read refs during render.

## Health, preflight and failure pages
- `GET /api/health` (public, in `proxy.ts`'s allow-list) opens the DB (`select 1`, which also runs the migrations on first use) and checks `DATA_DIR` and `UPLOAD_DIR` for write access. Any failure gives `503 {"ok":false}`; the cause only goes to the server log, never to the response. The Docker `HEALTHCHECK` uses it.
- `src/instrumentation.ts` `register()` runs once at boot (Node runtime, `NODE_ENV=production`) and logs `FATAL:` lines for an unwritable `DATA_DIR`, a missing or short (< 32) `SESSION_SECRET`, and a missing or `change-me` `APP_PASSWORD`. It logs and carries on (no crash loop; the login page and `/api/health` report the same). The logic is `preflightProblems()` in `src/lib/preflight.ts`.
- A DB that fails to open (newer than the code, a migration that broke foreign keys, a failed pre-migrate backup, corruption) logs `FATAL: database startup failed: …`; the failed connection is not cached, so the next request retries.
- `app/error.tsx`, `app/global-error.tsx` and `app/not-found.tsx` show a short message with the error digest and "Try again" (no stack, no message), using the app's tokens and the `ui.tsx` buttons (shared `components/error-screen.tsx`).

## Deployment
- `Dockerfile` builds a multi-stage, standalone image, with data in a `/data` volume and a healthcheck at `/api/health`. `ENTRYPOINT scripts/docker-entrypoint.sh`: started as root (the default) it creates `/data` and `/data/uploads`, `chown -R node:node /data` and `exec setpriv --reuid=node --regid=node --init-groups node server.js` (setpriv is in util-linux of the bookworm base); started as any other user (compose `user:`) it just execs the command, so the host dir must already be writable by that uid.
- `docker-compose.yml` binds to `127.0.0.1:3000` and sets `no-new-privileges`. Put Caddy or nginx in front for HTTPS (see README). Don't add `cap_drop: [ALL]`: the entrypoint needs CHOWN, SETUID and SETGID.
- The standalone output must contain the `drizzle/` folder, because migrations read it at runtime. The Dockerfile copies it, and `next.config.ts` traces it too. `outputFileTracingExcludes` keeps the repo's `src/`, `docs/`, `test/`, `e2e/`, `scripts/`, `coverage/` and config files out of `.next/standalone` (the tracer otherwise follows `process.cwd()` joins into them). `sharp` (~29 MB) still ships because Next adds it itself.
- `scripts/backup.sh` / `scripts/restore.sh` are covered by `src/scripts.test.ts` (it runs them against temp dirs, and needs the `sqlite3` CLI). Docker itself is not exercised by any test.
