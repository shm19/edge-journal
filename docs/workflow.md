# Change workflow: every feature, fix and plan step goes through this

Decided by Shayan on 2026-10-02. **No change skips a stage.** A change is any feature, fix, refactor or plan step. Small changes go through the stages quickly, but every stage still happens and is recorded.

```
 1. Scope ──► 2. Build (lazy-developer) ──► 3. Two reviews in parallel ──► 4. Triage & apply
                                              ├─ Code reviewer (senior engineer)
                                              └─ Product reviewer (PM / designer)
 ──► 5. Tests: add/update + run ──► 6. Docs ──► 7. Verify in browser ──► 8. Commit & record
```

## 1. Scope
- Write the task down in `CHECKPOINT.md`: what, why, and "Done when". Plan steps already have this.
- Do **one task at a time**. Stop for Shayan's review between plan steps.
- If anything is ambiguous, ask before building.

## 2. Build: use **Shayan's own lazy-developer skill**
- Invoke it with the Skill tool as `anthropic-skills:lazy-developer` before writing code.
- This is **Shayan's own skill**, from his personal skill set (the same set as `panto-prd` and `pm-mentor`). When it loads, its base directory is under `…/skills-plugin/…/skills/lazy-developer`. Confirmed on 2026-10-02.
- **Never substitute** another "lazy" or "minimal" skill, plugin or prompt.
- If that exact skill isn't available, **stop and ask Shayan**. Don't build without it.
- Follow its rules:
  - **Read first.**
  - **Climb its decision ladder, stopping at the first rung that works:**
    1. Does it need to exist at all?
    2. Is it already in the codebase?
    3. Does the stdlib do it?
    4. Is there a native platform feature?
    5. Is it in an installed dependency?
    6. Can it be one line?
    7. Only then, the minimum custom code.
  - **Say which rung you landed on.**
  - **Never cut its guardrails:** validation, error handling, security, accessibility.
- Follow the project conventions in [AGENTS.md](../AGENTS.md) and [architecture.md](architecture.md):
  - UTC only;
  - desktop only;
  - "use client" export rules;
  - shared helpers in `src/lib`;
  - UI primitives from `components/ui.tsx`.
- Never compromise validation, auth, error handling or accessibility.
- At the end, list the changed files and the reasoning ("what I didn't build and why"). Stage 3 needs this.

## 3. Two independent reviews (run **in parallel**, report only)
Start **two separate agents** in a single message. Neither edits files. Each returns a written report and a prioritized list (P0 / P1 / P2) with file:line references.

### 3a. Code reviewer (senior engineer)
Prompt template (fill in `<…>`):
> You are a senior full-stack engineer reviewing a change to Edge Journal (Next.js 16, React 19, SQLite/Drizzle). REPORT ONLY; do not edit files.
>
> Read `AGENTS.md`, `docs/architecture.md` and `docs/data-model.md` first.
>
> The change: `<task + Done-when>`. Changed files: `<list>`. Builder's notes: `<summary>`.
>
> Review for:
> - correctness and edge cases (R math, UTC, statuses, transactions);
> - server/client boundaries ("use client" exports, `server-only`);
> - security (auth on actions and routes, validation, uploads);
> - simplicity, meaning what can be deleted or reused (lazy-developer standard);
> - duplication;
> - performance;
> - naming and readability;
> - test gaps (which tests must be added or updated);
> - consistency with existing patterns.
>
> Return P0/P1/P2 findings with file:line references and a concrete fix for each, then a short "tips" section.

### 3b. Product reviewer (PM / product designer)
Prompt template:
> You are a senior product manager and product designer reviewing a change to Edge Journal, the personal crypto trading journal of a beginner discretionary trader who is R-first and wants essentials only. REPORT ONLY; do not edit files.
>
> Read `docs/product.md` (the user, the core model, decisions, non-goals) and `AGENTS.md`.
>
> The change: `<task + Done-when>`. Changed files: `<list>`.
>
> If a dev server is running, log in (the password is `APP_PASSWORD` in `.env.local`; never print it) and try the change on **desktop only**.
>
> Review for:
> - fit to his needs and stated asks;
> - the workflow (clicks, friction, defaults);
> - copy and labels;
> - empty, error and loading states;
> - visual consistency with the rest of the app;
> - whether the numbers or metrics shown are correct and not misleading;
> - bloat (anything to cut);
> - anything missing that he'll obviously need.
>
> Return P0/P1/P2 findings, each with the screen or file affected and a concrete suggestion.

## 4. Triage & apply
- Merge both reports into one list in `CHECKPOINT.md`, under the task's notes. Mark each item as **apply**, **defer** (moved to Backlog with the reason) or **reject** (with the reason).
- **Apply** all P0 items and the agreed P1 items. P2 items are applied only if they're cheap, otherwise they go to the Backlog.
- If the reviewers disagree, or a suggestion changes product behaviour beyond the task, ask Shayan.
- Keep using the lazy-developer approach while applying fixes.

## 5. Tests: add/update and run
- Every behaviour added or changed gets a test:
  - pure logic → `src/lib/*.test.ts`;
  - server logic → DB-backed tests;
  - client components → React Testing Library;
  - user flows → Playwright.
- Fix or replace tests the change made obsolete. Never delete a test just to make the suite pass.
- Run the full checks. Until plan Step 3b adds `npm run check` and `npm run e2e`, run `npm test && npm run typecheck && npm run lint && npm run build`. After that:
  ```bash
  npm run check
  ```
  ```bash
  npm run e2e
  ```
- All of them must be green, and the coverage thresholds must hold.

## 6. Docs
Update whatever the change touched:
- `docs/product.md`: decisions and the model;
- `docs/architecture.md`: structure and conventions;
- `docs/data-model.md`: tables, math, migrations, seed versions;
- `docs/backtesting.md`;
- `README.md`: user-facing features;
- `AGENTS.md`: the "where to change things" table and gotchas;
- this file, if the process itself changes.

Docs are part of the change, not a follow-up.

## 7. Verify in the browser (desktop)
- After any migration, restart the dev server: `preview_start edge-journal-dev`, port 3100.
- Click through the changed flow and check that the console shows no errors.
- If the change is visible in the backtest instance on port 3200, rebuild and restart it (see `CHECKPOINT.md` → Running instances).

## 8. Commit & record
- Once git exists (plan Step 0), commit with a conventional message (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`). Use separate commits for the build and for the review fixes when that helps readability.
- In `CHECKPOINT.md`:
  - tick the task;
  - add a short "What was done" and "Verified" note;
  - add the review triage summary (applied / deferred / rejected);
  - add the commit hash(es).
- Then **stop** and report to Shayan: what changed, what the reviewers said, what was applied, the test results, and anything deferred.

## Checklist (copy into the task's notes in CHECKPOINT.md)
```
- [ ] 1 Scope written (what / why / done-when)
- [ ] 2 Built with lazy-developer skill (changed files + notes listed)
- [ ] 3a Code review received
- [ ] 3b Product review received
- [ ] 4 Triage: applied / deferred / rejected recorded; fixes applied
- [ ] 5 Tests added/updated; check (+ e2e) green; coverage holds
- [ ] 6 Docs updated
- [ ] 7 Desktop browser check, no console errors; instances restarted
- [ ] 8 Committed (hash) and CHECKPOINT updated; reported to Shayan
```
