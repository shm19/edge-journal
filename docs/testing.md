# Testing

## Run
```bash
export PATH=/Users/shm/.nvm/versions/node/v22.16.0/bin:$PATH
npm test                # vitest run, no coverage
npm run test:coverage   # vitest run --coverage; fails if a threshold is missed
npx vitest run src/lib/actions-crud.test.ts   # one file
```
Config: `vitest.config.mts` (`.mts` so Vite loads it as ESM). `testTimeout` is 30 s because the jsdom component tests are slow under v8 instrumentation. Playwright e2e is separate (`npm run e2e`, `e2e/`: 6 spec files, 19 tests, about 1.5 min).

## Layout
| Kind | Where | Notes |
|---|---|---|
| Pure logic | `src/lib/*.test.ts` | No DB, no mocks. Build views with `test/fixtures.ts` (`makeIdea`, `makeScenario`, `makeMistake`, `makeSetup`, `makeTag`). |
| Server logic (DB) | `src/lib/{queries,actions*}.test.ts`, `src/db/seed.test.ts`, `src/app/api/routes.test.ts` | Real SQLite in a temp dir. |
| Deploy / ops | `src/db/migrate.test.ts` + `src/db/index.test.ts` (temp DBs: pre-migrate backup, newer-DB refusal, destructive-migration safety), `src/lib/preflight.test.ts`, `src/instrumentation.test.ts`, `src/app/api/health/health.test.ts`, `src/next-config.test.ts` (header sources matched the way Next does: exactly one CSP per path), `src/scripts.test.ts` (spawns `docker-entrypoint.sh` with stubbed `id`/`chown`/`setpriv`, and `backup.sh` / `restore.sh` against temp dirs; the backup/restore blocks skip themselves when the `sqlite3` CLI is missing; Docker itself is never run) | Real SQLite in temp dirs, real shell scripts. Unwritable-dir cases skip when run as root. |
| SSH deployment | `src/deploy-scripts.test.ts` (about 90 s, the slowest file in the suite, because it simulates real deploys; ports 3811-3829) | The real `scripts/server.sh` and `deploy/*.sh` against a temp `ROOT`: `remote-deploy.sh` with a stub `systemctl` (starts a tiny node app with a real SQLite DB and `/api/health`) and a stub `npm`; covers first deploy, backup-before-swap, automatic rollback with a byte-identical data dir, the "newer DB" restore path with `.pre-restore-*` copies, deploy lock, release pruning, `remote-admin.sh` (rollback / restore / stage-backups / status), `server-setup.sh` as non-root (env file created once, merged, never rotated silently) and the laptop script through stub `ssh` / `scp` / `sudo` (secrets never in argv). `sh -n`, `bash --posix -n` and `dash -n` for every script. Skips itself without `sqlite3`, `curl`, `git`, `tar`, `gzip` or `node`. Real systemd, apt, sudo, a Linux build and a real ssh host are **not** exercised (see [deployment.md](deployment.md)). |
| Auth | `src/lib/auth.test.ts`, `session.test.ts`, `login-guard.test.ts`, `src/proxy.test.ts` | `next/headers` and `next/navigation` mocked. |
| Components | `src/components/ui/select.test.tsx` tests `Select` itself (19 tests) and `src/components/ui/date-picker.test.tsx` the calendar pickers (50 tests, `Date` faked to 2026-10-02 23:30 UTC), `src/components/nav.test.tsx` the "n" shortcut (3 tests), `src/app/error-pages.test.tsx` (error, global-error, not-found; 4 tests); `src/components/balance-form.test.tsx` (form + results, 18 tests) and `balance-card.test.tsx` (4 tests); `src/components/idea-table.test.tsx` (journal / setup / dashboard table columns and the "if taken" label, 5 tests), `setup-editor.test.tsx` (name helper, 2 tests), `src/app/globals.test.ts` (button colours meet 4.5:1, 2 tests); suite total **723 tests in 44 files** (last full run, 2026-10-03); `src/components/**/*.test.tsx` (`test/select.ts` `chooseOption(user, label, option)` drives the custom `Select`; `test/setup-dom.ts` polyfills `ResizeObserver` and `scrollIntoView`) | `// @vitest-environment jsdom`, React Testing Library; `test/setup-dom.ts` adds jest-dom matchers. |

## Temp-DB helper: `tempDb` (`test/db.ts`)
The DB opens lazily and caches its connection, so each test file does:
```ts
async function load() {
  await tempDb();                                  // fresh DATA_DIR, resetModules, drops the cached connection
  const actions = await import("@/lib/actions");   // import AFTER tempDb(), never at the top of the file
  const { db, UPLOAD_DIR } = await import("@/db");
  return { actions, db, UPLOAD_DIR };
}
beforeEach(async () => { ctx = await load(); });
```
The DB is migrated and seeded on first use, so setups, tags, scenario types and mistake types exist. `SESSION_SECRET` is set in `test/setup.ts`; `next/cache` is mocked there.

## Mocking rules
- Mock only `@/lib/auth` (`isAuthenticated` → a hoisted flag) for actions and routes, and `next/headers` / `next/navigation` when testing `auth.ts` itself. `next/cache` is mocked globally.
- Never mock the DB, `drizzle`, `fs` or the app's own modules. Assert real outcomes: rows, returned `ActionResult`s, files on disk.
- To reach states the UI can't produce (dangling references), turn `PRAGMA foreign_keys` off on `sqlite` from `@/db` for the insert, then back on.
- A test that asserts nothing, or only that a mock was called, doesn't count.

## Thresholds (`vitest.config.mts`, enforced by `npm run test:coverage`)
| Scope | Lines / branches |
|---|---|
| `src/lib/{stats,price,tz,format,validation,editor-shape,metrics,analytics,status,date-input,balance}.ts` (pure logic) | 100 % / 100 % |
| `src/lib/{queries,actions,settings,auth,session,login-guard,csv,image-sniff,preflight}.ts`, `src/db/{seed,migrate}.ts`, `src/app/api/**` | ≥ 90 % / ≥ 90 % |
| Everything included | ≥ 80 % (lines, branches, functions, statements) |

Included: `src/lib/**`, `src/db/seed.ts`, `src/db/migrate.ts`, `src/app/api/**`, `src/proxy.ts`. **Components are left out**: only ~40 % is reachable with unit tests (charts, nav, forms, gallery have none); their behaviour is covered by the Playwright e2e flows instead. Add them to `coverage.include` once component tests reach 80 %.

## Coverage gaps (v8 ignore comments)
Every ignore is a defensive branch that no input can reach. Keep this table in sync.
| File | What | Why it can't be covered |
|---|---|---|
| `src/db/seed.ts` `upgrade()` | `/* v8 ignore else */` on `if (version < 4)` | While `SEED_VERSION` is 4 the else arm is dead. Remove the ignore when the next upgrade step is added. |
| `src/lib/queries.ts` `setupIdeaCount` | `?? 0` | `count()` always returns one row. |
| `src/lib/actions.ts` `saveIdea` | `scenarioIds[m.scenarioIndex] ?? null` | `ideaSchema` already rejects a mistake pointing at a missing scenario. |
| `src/lib/actions.ts` `saveIdea` | `e instanceof Error ? … : "Failed to save"` | Only `Error`s are thrown in the transaction. |
| `src/lib/login-guard.ts` `safeNext` | `catch { return "/" }` | `new URL("/…", base)` can't throw for a string that starts with `/`. |
