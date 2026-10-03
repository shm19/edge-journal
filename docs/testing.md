# Testing

## Run
```bash
export PATH=/Users/shm/.nvm/versions/node/v22.16.0/bin:$PATH
npm test                # vitest run, no coverage
npm run test:coverage   # vitest run --coverage; fails if a threshold is missed
npx vitest run src/lib/actions-crud.test.ts   # one file
```
Config: `vitest.config.mts` (`.mts` so Vite loads it as ESM). `testTimeout` is 30 s because the jsdom component tests are slow under v8 instrumentation. Playwright e2e is separate (`npm run e2e`, `e2e/`).

## Layout
| Kind | Where | Notes |
|---|---|---|
| Pure logic | `src/lib/*.test.ts` | No DB, no mocks. Build views with `test/fixtures.ts` (`makeIdea`, `makeScenario`, `makeMistake`, `makeSetup`, `makeTag`). |
| Server logic (DB) | `src/lib/{queries,actions*}.test.ts`, `src/db/seed.test.ts`, `src/app/api/routes.test.ts` | Real SQLite in a temp dir. |
| Auth | `src/lib/auth.test.ts`, `session.test.ts`, `login-guard.test.ts`, `src/proxy.test.ts` | `next/headers` and `next/navigation` mocked. |
| Components | `src/components/ui/select.test.tsx` tests `Select` itself (19 tests; suite total 362 in 26 files); `src/components/**/*.test.tsx` (`test/select.ts` `chooseOption(user, label, option)` drives the custom `Select`; `test/setup-dom.ts` polyfills `ResizeObserver` and `scrollIntoView`) | `// @vitest-environment jsdom`, React Testing Library; `test/setup-dom.ts` adds jest-dom matchers. |

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
| `src/lib/{stats,price,tz,format,validation,editor-shape,metrics,analytics,status}.ts` (pure logic) | 100 % / 100 % |
| `src/lib/{queries,actions,settings,auth,session,login-guard,csv,image-sniff}.ts`, `src/db/seed.ts`, `src/app/api/**` | ≥ 90 % / ≥ 90 % |
| Everything included | ≥ 80 % (lines, branches, functions, statements) |

Included: `src/lib/**`, `src/db/seed.ts`, `src/app/api/**`. **Components are left out**: only ~40 % is reachable with unit tests (charts, nav, forms, gallery have none); their behaviour is covered by the Playwright e2e flows instead. Add them to `coverage.include` once component tests reach 80 %.

## Coverage gaps (v8 ignore comments)
Every ignore is a defensive branch that no input can reach. Keep this table in sync.
| File | What | Why it can't be covered |
|---|---|---|
| `src/db/seed.ts` `upgrade()` | `/* v8 ignore else */` on `if (version < 4)` | While `SEED_VERSION` is 4 the else arm is dead. Remove the ignore when the next upgrade step is added. |
| `src/lib/queries.ts` `setupIdeaCount` | `?? 0` | `count()` always returns one row. |
| `src/lib/actions.ts` `saveIdea` | `scenarioIds[m.scenarioIndex] ?? null` | `ideaSchema` already rejects a mistake pointing at a missing scenario. |
| `src/lib/actions.ts` `saveIdea` | `e instanceof Error ? … : "Failed to save"` | Only `Error`s are thrown in the transaction. |
| `src/lib/login-guard.ts` `safeNext` | `catch { return "/" }` | `new URL("/…", base)` can't throw for a string that starts with `/`. |
