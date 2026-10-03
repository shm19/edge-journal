# Launch audit, 2026-10-03

The record of the checks done before tagging v0.2.0, what they found, what was fixed, and what was **not** done. Written in plain language on purpose. The fixes are listed in [CHANGELOG.md](../CHANGELOG.md); the deployment guide is [deployment.md](deployment.md).

## What was checked
- **Fresh-clone build.** A clean clone of the repo: `npm ci`, `npm run check` (lint, typecheck, unit tests with coverage, build), all 19 e2e tests, and a smoke test of the Docker-style runner layout (the standalone build started from a copied folder, as the image would run it).
- **The numbers.** Every figure the app shows was recomputed independently, straight from the raw SQLite tables, about 7,000 checks in total. They ran against copies of the owner's two real databases and against synthetic edge cases (break-even band edges, "not filled" exits, identical timestamps, tiny and huge prices, risk of 0 / negative / missing, overlapping mistakes, daylight-saving sessions, empty and one-trade journals). Result: **0 mismatches**, except one documented divergence (an idea whose only scenario is an alternative).
- **Upgrade path.** Old databases (v0.1.0 and earlier) opened by the new code: every migration is additive and ran with zero row loss.
- **Backup and restore.** `backup.sh`, the Settings download, `restore.sh`, the "database is newer than the code" refusal, and a stale WAL file next to a restored database (this one corrupts a restore, and is now handled).
- **Security, static and live.** Every route, page and server action enumerated and probed (about 150 live probes in production mode): auth gate, open redirect, login throttle, uploads, exports, XSS payloads in every text field, CSV formula injection, error pages, secrets in the build output, dependency audit.
- **First-run walkthrough.** Using the app as a brand-new user: empty states, creating a setup and an idea, mistakes, alternatives, forward tests, settings, export, sign out, two tabs, 1024 px and 1280 px windows, keyboard use.
- **Whole-codebase review.** A final read of the code on top of HEAD.
- **Accessibility contrast.** Computed from the colour tokens, not by eye.

## Results
| Area | Verdict |
|---|---|
| Security | Ship after fixes |
| Data safety (migrations, backup, restore) | Safe after fixes |
| Numbers | Trustworthy |
| First run | Ready after fixes |
| Code review | Ready after fixes |

No blocking (P0) finding was left open. Contrast: all text and accent colours pass WCAG AA; the only miss was white text on the primary button (4.47:1), now fixed (4.88:1).

## What was fixed
**Deploy and data safety**
- Docker first deploy: the data folder was owned by root and the app could not write (every page failed while the healthcheck stayed green). Fixed with an entrypoint that fixes ownership and drops privileges.
- Seed bug: deleting all setups and scenario types bricked the app on the next start.
- Migrations: foreign keys off during a migration, the integrity check rolls the migration back (found by the code review: it used to run after the commit), a copy is written before every migration, a database newer than the code is refused.
- `restore.sh` could overwrite the only copy of your live data on a second restore (found by the code review); it now keeps every replaced database under a new name.
- `backup.sh`: private files, unique names, fails on a missing database, checks its own copy, retention works with spaces in paths.
- `/api/health` really checks the database and disk; boot warnings for a missing or default password and secret; friendly error pages.
- The "SQLite backup" button said backup but excluded screenshots; relabelled.

**Security**
- Login limiter: the first version could be used to lock the owner out (found by the code review). Now password checks run one at a time through a small queue, so at most about 6 guesses a minute are checked; extra parallel attempts are turned away unchecked; the owner is only ever slowed.
- The throttle could be bypassed with a forged `X-Forwarded-For` header and its memory was unbounded; an open redirect (`/.//host`) after login.
- Default `change-me` password refused; sessions signed with a key that includes the password (one-time logout for everyone).
- Remote images in markdown no longer load; one CSP per route; frame denial, `Permissions-Policy`, `no-store` on exports; upload size counted while streaming.

**Editor and UI**
- Silent data loss: text in a price box, a mistake cost or a risk field is now an error instead of being dropped; a stale scenario id from another tab no longer breaks a save.
- Unsaved-changes prompt on in-app links; Back after save no longer returns to the form; field-level errors scroll to and focus the field.
- Layout at 1024 px (clipped tables), "if taken" labels on skipped and missed ideas, a few misleading dashboard labels, accessible names on price boxes.

## What was NOT done, and known limitations
**Audit gaps**
- **Performance at scale was not measured.** The scale part of the numbers audit was never completed (its report stops after the correctness checks). Stats are computed in memory from the whole journal; the owner is the only user and will report problems.
- The first code-review run was cut off and was resumed; the second pass covered the rest, but it is two partial runs, not one clean one.
- **Docker was never run on the dev machine.** The Dockerfile, entrypoint and compose file were reviewed by reading them, and the entrypoint is tested with stubs.
- **The SSH deployment was never run against a real server.** It was simulated locally (stub `systemctl` / `ssh` / `sudo`, plus a real `next build` and `next start` on macOS). Real systemd, `apt` and a Linux build are untested. Expect to fix small things on the first real deploy; `doctor` and `status` are there for that.
- Only Chrome was tested, desktop only (1024 px or wider).

**Known limitations (by decision)**
- Sessions are stateless tokens, revocable only by changing `SESSION_SECRET` or `APP_PASSWORD`. No 2FA. No import.
- The JSON and SQLite exports leave out screenshot files; use `scripts/backup.sh` or `./scripts/server.sh pull-backups`.
- Browser Back is not intercepted by the unsaved-changes guard.
- `saveIdea` is last-write-wins across two tabs (the older tab silently overwrites).
- Remote images in markdown are blocked by the CSP.

## Deferred backlog (P2, not fixed)
Taken from the audit reports; checked against the code where cheap, so a line may be slightly out of date. The same items were added to the Backlog in [CHECKPOINT.md](../CHECKPOINT.md).

**Security and hardening**
- `__Host-` cookie name; HSTS and `script-src` in the CSP (HSTS belongs on the proxy); a `/_next/image` exclusion that nothing needs in the proxy matcher.
- Docker: pin the base image digest, `read_only` + `tmpfs`, `cap_drop`; `chown -R` aborts the container on filesystems that refuse it (NFS root-squash); `backup.sh`'s `docker compose exec` should run `-u node`.
- Server actions behind a proxy need the public `Host`; an `allowedOrigins` env setting would be friendlier.
- Upload type check is by magic bytes only; unbounded arrays in the validation schemas (limited only by the 1 MB body cap); `robots.ts` / `X-Robots-Tag` (a `noindex` meta tag exists); run `npm audit --omit=dev` in CI.

**Data and scripts**
- Uploaded files that are never attached to an idea are never cleaned up and are included in every backup (`prune-uploads.sh` idea).
- `backup.sh` aborts if the uploads folder changes while `tar` reads it (re-run fixes it); `restore.sh` needs the host `sqlite3`, does not inspect symlinks inside the archive and prints no message if the final move fails; README does not mention `sudo` for the scripts when the host user is not uid 1000.
- Two processes starting on an empty data dir at the same time can give one transient 500; drizzle's migrator compares only the last migration time, so a back-dated migration would be skipped.
- `instrumentation.ts` boot check is not wrapped in try/catch; the `change-me` check in `preflight.ts` is case-sensitive while login's is not; a failed pre-migrate backup is retried on every health probe.
- No SIGTERM WAL checkpoint (a main-file-only copy can miss the newest writes).
- `stats.ts` does not `isFinite`-check entry and stop (only an infinite price written by a script could break it).
- Tests: the "refuses to continue" migration test does not assert the rollback; backup/restore tests skip silently without the `sqlite3` CLI; no test for parallel logins.

**Editor, dashboard and UI**
- No "exit looks like a typo" warning for a huge R (a mistyped `1.234,5` gave -125R and was accepted silently).
- A mistake silently flips "Followed my plan?" to No; the skip reason is asked twice (free text and the tag).
- Keyboard users tab through about 33 tag chips before reaching Entry; Esc does nothing in the editor; Delete uses the browser's `confirm`.
- Analytics hides its tabs on an empty journal; "Group by" has 22 options; equity-curve axis ticks are irregular and crowded; "Needs attention" can list 8 "No review written" rows; Skipped + Missed totals can differ from the rows by rounding.
- Settings: generic "must be a number" for out-of-range values, a default risk of 0% is accepted, labels are not tied to inputs.
- At 1024 px the dashboard Setups card truncates names and the editor is about 1700 px tall at 1280 x 800.
- Bundle: load the charts and the markdown preview with `next/dynamic` (409 KB and 234 KB chunks).
