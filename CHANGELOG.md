# Changelog

All notable changes are recorded here, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow [SemVer](https://semver.org/).

> **About the history before v0.1.0.** The app was built (2026-10-02, sessions 1–4) before a git repository existed. The commits up to the `v0.1.0` tag are **milestone commits reconstructed from the final state**: the files were grouped by area in dependency order, so `git log` tells the story. Commit timestamps are the time of the reconstruction, not when the work was done. Intermediate commits may not build on their own. `v0.1.0` and every commit after it build and pass the checks. From v0.1.0 on, every plan step and change follows [docs/workflow.md](docs/workflow.md) and gets its own commit(s).

## [Unreleased]
### Removed
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
