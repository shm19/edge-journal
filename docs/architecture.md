# Architecture

## Stack
Next.js 16 (App Router, server actions, Turbopack), React 19, TypeScript, Tailwind 4 (dark theme tokens in `src/app/globals.css`), SQLite through better-sqlite3 + Drizzle ORM, zod, jose (JWT session), Recharts, react-markdown. Single process, single user.

## Folder map
```
src/
  proxy.ts                 Auth gate for every route except /login, /api/health, /api/uploads (that route checks auth itself)
  app/
    layout.tsx             Root HTML shell (system fonts, no external font fetch)
    login/                 Login page + server actions (login/logout, throttle, safe ?next= redirect)
    (app)/                 Authenticated area. layout.tsx = requireAuth + sidebar (force-dynamic)
      page.tsx             Dashboard
      ideas/               Journal list, new, [id] detail, [id]/edit
      setups/              Playbook list, new, [id] detail, [id]/edit
      analytics/page.tsx   Tabs: breakdown | alternatives | skips
      settings/page.tsx    General settings, tags & groups, scenario types, export, sign out
    api/
      uploads/             POST image (magic-byte check, 10 MB); [name] GET serves it (auth, nosniff)
      export/              ?format=csv|json|db
      health/              Public liveness check
  db/
    schema.ts              Drizzle tables + enums (status, exit reasons, …)
    index.ts               Lazy connection (WAL, FKs), runs migrations + seed on first use
    seed.ts                First-run seed + versioned additive upgrades (SEED_VERSION)
  lib/
    stats.ts               PURE: R math, summarize, groupSummaries, compareScenarios, skipAudit, sessions (DST-aware)
    queries.ts             Server (server-only): ALL DB reads. loadIdeas() → IdeaView (joins + computed R), targeted getIdea() (React cache()),
                           ideaNeighbours() (prev/next in SQL), getSetup, setupIdeaCount, usageCounts, lastSymbol, list* helpers
    analytics.ts           PURE (types-only import of queries): parseFilters/applyFilters, DIMENSIONS + dimensionKeys, rrBucket,
                           scenarioComparisons, observationStats, mistakeSummary, tagGroupNames
    status.ts              PURE: STATUS_BUCKETS (taken / skips / forward / backtest), inBuckets(), isOpen(). The only place that groups statuses
    actions.ts             "use server": all mutations (saveIdea, setups, tags, tag groups, scenario types, settings)
    validation.ts          zod schemas + human-readable errors
    settings.ts            getSettings() with defaults
    auth.ts / session.ts   Password check, JWT cookie (session.ts is edge-safe for proxy.ts)
    price.ts / tz.ts       Price parsing; APP_TIMEZONE = "UTC" + zone helpers (sessions) (shared client + server)
    editor-shape.ts        Editor form-state types + IdeaView → form mapping (shared)
    format.ts              Formatting + label maps
    metrics.ts             Analytics metric list (shared)
  components/              ui.tsx primitives, bits.tsx domain bits, charts (client), editors (client), tables
drizzle/                   SQL migrations (committed). Applied automatically at startup.
scripts/                   backup.sh + backtest pipeline (see docs/backtesting.md)
```

## Data flow
- **Reads.** Server components call `loadIdeas()` (`src/lib/queries.ts`), which loads all rows into memory, joins them and computes R per scenario. Pages then filter with `applyFilters(list, filters)` (`src/lib/analytics.ts`) and aggregate with `stats.ts`. Pages never touch `db` directly: add a function to `queries.ts` instead. Single-idea pages use `getIdea(id)`, which filters the child tables in SQL; prev/next uses `ideaNeighbours()`. `loadIdeas()` stays a full in-memory load for list and analytics pages (fine up to a few thousand ideas; not measured). No client-side data fetching.
- **Writes.** Client components call server actions in `src/lib/actions.ts`. Each action:
  1. runs `requireAuth()`;
  2. validates with zod;
  3. writes in a transaction;
  4. calls `revalidatePath("/", "layout")`.

  The client then calls `router.push` / `router.refresh`.
- **URL state.** Filters, group-by, metric, tab and range live in search params (`components/filter-bar.tsx`, `analytics-controls.tsx`). The filter bar reads `window.location.search` when updating, to avoid stale params.

## Server/client boundaries
- Files with `"use client"` export **components only** as far as the server is concerned. A constant exported from a client module becomes a client reference on the server, so `METRICS.find` breaks. Shared values go in plain `src/lib/*` modules.
- `src/db` and `src/lib/{queries,settings,auth}.ts` import `server-only`. `analytics.ts`, `status.ts` and `stats.ts` are pure (no DB), so they are unit-tested without a database; fixtures for them are in `test/fixtures.ts`.
- **Statuses are grouped only in `status.ts`.** Never compare `idea.status === "..."` in a page; use `inBuckets(list, "taken")` etc. A test fails if an `IDEA_STATUSES` value is in no bucket (or two).

## Auth
- `APP_PASSWORD` (env) is compared in constant time.
- Sessions are an HS256 JWT in the `ej_session` cookie, valid 30 days, signed with `SESSION_SECRET`, which must be 32+ characters in production.
- Cookie flags: `Secure` in production unless `COOKIE_SECURE=false`.
- Login throttle: 5 failures per client IP → 60 s lock, held in memory.
- `?next=` must be a same-origin relative path.

## Conventions
- **UI:**
  - Use the tokens: `bg-panel`, `border-line`, `text-muted`, `text-faint`, `text-win`, `text-loss`, `accent`.
  - Use the primitives from `components/ui.tsx`.
  - Empty values render "—", never 0.
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
- **Lint:** React-compiler rules apply. Use `useSyncExternalStore` for browser-only values, never `setState` inside an effect, and never read refs during render.

## Deployment
- `Dockerfile` builds a multi-stage, standalone image that runs `node server.js`, with data in a `/data` volume and a healthcheck at `/api/health`.
- `docker-compose.yml` binds to `127.0.0.1:3000`. Put Caddy or nginx in front for HTTPS (see README).
- The standalone output must contain the `drizzle/` folder, because migrations read it at runtime. The Dockerfile copies it, and `next.config.ts` traces it too.
