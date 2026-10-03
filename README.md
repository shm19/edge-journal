# Edge Journal

A personal, self-hosted trading journal for discretionary crypto trading. It's built around **setups**, **R-multiples** and **"what if" scenarios**.

## What it does
- **Ideas.** Every setup you see gets logged as **Taken**, **Skipped**, **Missed**, **Forward test** or **Backtest**. Skipped and missed ideas need a reason, so you can later check whether skipping was the right call. Backtests and forward tests never mix into your real (taken) stats.
- **Yes/no hypotheses.** A forward test can be an observation with no prices, marked **Hit / Miss** (e.g. "weekly open revisited this week"). The setup page shows the hit rate.
- **Scenarios.** Each idea has a primary scenario: what actually happened, or the plan if you didn't take it. You can add alternatives such as *BE stop*, *Wick entry*, *ATR stop* or *Hold to target*. Each one gets its own entry, stop, target and exit, and **R is computed automatically**.
- **Setups (playbook).** Each setup has rules (markdown), a pre-trade checklist and a status: testing, live or retired. Its page shows stats, an equity curve, breakdowns and a chartbook of screenshots.
- **Tags in groups** (Level, Approach, Candle, Context, Mistake, …). Every tag group becomes its own analytics breakdown.
- **Analytics:**
  - Win rate, expectancy, total R, profit factor, drawdown and plan adherence.
  - Break results down by setup, tag, tag group, coin, timeframe, HTF bias, range/trend, session, weekday, month or followed-plan.
  - **Actual vs alternative** comparison.
  - **Skip audit**: R left on the table vs losses avoided.
  - **Balance simulator** (Analytics → Balance, a dashboard card, a "Simulate" link on each setup): "how much would I have made?" from a starting balance, a risk % (or each trade's own), compounding or fixed, optional fees. It is **hypothetical**, follows the normal filters and labels non-taken statuses as not live.
- **Exit types.** Alternatives can be marked **Not filled** (counts as 0R), so limit-entry variants like "wick entry" are judged fairly.
- **Prices** accept `64,250`, `64250.5` or `1.234,5`. The parsed number is echoed under the field.
- **Times** are always UTC: stored, entered and shown in UTC, and not configurable.
- **Screenshots.** Paste (⌘V), drag and drop, or browse.
- **Export.** Trades as CSV, everything as JSON, or the database file (no screenshots). Full backups, with screenshots, come from `scripts/backup.sh`.
- **Desktop only.** There is no mobile layout; the app needs a window at least 1024 px wide.
- Single-user password login. Your data stays on your server.

## Run locally
Requires Node 22+.
```bash
npm install
```
```bash
cp .env.example .env.local
```
Edit `.env.local` and set `APP_PASSWORD`. Then start the dev server:
```bash
npm run dev
```
Open http://localhost:3000. On first start the database is created in `DATA_DIR` and seeded with your setups, tags and scenario types.

## Deploy on your server (SSH, no Docker)
The main path: copy the code over SSH from your laptop to a Debian/Ubuntu (systemd) server, build it there, run it as a hardened systemd service with a daily backup timer. No Docker, no domain, no GitHub needed. Your data lives outside the code, every deploy makes a verified backup first, and a bad release rolls itself back.
```bash
cp deploy/deploy.env.example .deploy.env      # set SERVER=you@your-server
./scripts/server.sh doctor                    # what does the server have? says what to fix
./scripts/server.sh init                      # once: user, folders, service, backup timer, your app password
./scripts/server.sh deploy                    # ships the committed code (git archive HEAD); run it again to update
./scripts/server.sh tunnel                    # then open http://localhost:3000
./scripts/server.sh pull-backups              # off-site copy to this laptop: do this regularly
```
Also: `status`, `logs`, `health`, `backup`, `restore <backup.db> [uploads.tar.gz]`, `rollback` (`./scripts/server.sh --help`, or `npm run server -- <command>`). The full guide, with backups, moving your local data, rollback, security and troubleshooting, is **[docs/deployment.md](docs/deployment.md)**.

## Docker alternative
Use this instead if the server has Docker with the Compose plugin and you want HTTPS in front with a domain. The SSH path above has no Docker and no HTTPS (private network or tunnel). Do these in order:

1. Get the code and create your config:
   ```bash
   git clone <this repo> edge-journal && cd edge-journal
   cp .env.example .env
   ```
2. Edit `.env`: set a real `APP_PASSWORD` (login is refused while it is empty or `change-me`) and `SESSION_SECRET` (`openssl rand -hex 32`). The container logs a `FATAL:` line at start if either is missing.
3. Start it:
   ```bash
   docker compose up -d --build
   docker compose ps          # wait for "healthy"
   docker compose logs journal
   ```
4. Put HTTPS in front (next section), then log in.
5. Set up backups (below) **before** you enter real trades, and copy them off the server.

The app listens on `127.0.0.1:3000` only. Never publish port 3000 to the internet; the reverse proxy is the only way in.

**The data directory.** The database and screenshots live in `./data` on the host (mounted at `/data`). Docker creates `./data` as root, so the container starts as root, fixes the ownership of `/data` and then runs the app as the unprivileged `node` user (uid 1000). You don't need to `chown` anything. If you add an explicit `user:` to `docker-compose.yml` (or run the image with `--user`), the entrypoint can't fix ownership: run `chown -R 1000:1000 data` yourself (or `chown` it to the uid you chose). `GET /api/health` returns 503, and the log shows `FATAL: DATA_DIR ... is not writable`, when the data directory, the database or the uploads folder is not usable.

### HTTPS / reverse proxy
Session cookies are `Secure` in production, so serve the app over HTTPS. The proxy must:
- pass the **public Host** to the app. Without `Host` or `X-Forwarded-Host`, every save fails with a 500 "Invalid Server Actions request";
- **set** (overwrite, never append) `X-Forwarded-For` to the client address. The login throttle trusts the **last** entry of that header, so a proxy that appends client-supplied values, or no proxy at all, lets an attacker dodge the throttle;
- allow uploads of up to 10 MB (screenshots), with a little headroom;
- add HSTS (`Strict-Transport-Security`). The app does not send it itself.

Caddy (`/etc/caddy/Caddyfile`). It does the Host and `X-Forwarded-For` parts by default:
```
journal.example.com {
  request_body {
    max_size 12MB
  }
  header Strict-Transport-Security "max-age=31536000"
  reverse_proxy 127.0.0.1:3000
}
```
nginx (inside a TLS `server` block for your domain):
```nginx
client_max_body_size 12m;
add_header Strict-Transport-Security "max-age=31536000" always;
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Host $host;
  proxy_set_header X-Forwarded-For $remote_addr;   # overwrite, not $proxy_add_x_forwarded_for
  proxy_set_header X-Forwarded-Proto $scheme;
}
```
If you really must use plain HTTP (a private LAN), set `COOKIE_SECURE=false`; any other value (`0`, `no`, a typo) keeps `Secure` on. `SESSION_SECRET` (32+ chars) is required whenever `NODE_ENV` is not `development`: without it, login fails instead of falling back to a public key.

### Backups
```bash
./scripts/backup.sh
```
This writes a consistent SQLite snapshot (`journal-STAMP.db`) **and** a tarball of the screenshots (`uploads-STAMP.tar.gz`) to `./backups` (override with `BACKUP_DIR`), and keeps the last 30 of each. It fails loudly (non-zero exit, nothing written) if there is no database at `DATA_DIR`. Run it as the user that owns `./data`, or as root. Daily at 03:00 via cron:
```
0 3 * * * /path/to/edge-journal/scripts/backup.sh >> /path/to/edge-journal/backups/cron.log 2>&1
```
- **Backups on the same disk are not off-site backups.** If the disk dies, so do they. Copy `./backups` to another machine (`rsync`, `rclone`, a cloud bucket).
- **Settings → Export & backup** has a "Database only (no screenshots)" download. It is handy for a quick copy, but it does not include screenshots, so it is not a full backup. Trades CSV and Full JSON are for analysis and portability (there is no import); they are not backups either.

**Restore** (stop the app first; use the db and uploads files with the same STAMP):
```bash
docker compose down
./scripts/restore.sh backups/journal-STAMP.db backups/uploads-STAMP.tar.gz
docker compose up -d
```
`restore.sh` checks the backup with `PRAGMA integrity_check` before touching anything, keeps the database it replaces (with its WAL files) as `data/journal.db.pre-restore-<timestamp>`, a new name every time so an earlier copy is never overwritten (delete them yourself once you're happy), makes sure no stale `journal.db-wal` / `-shm` stays next to the restored database (that would corrupt it), restores the screenshots (merged into `data/uploads`) and re-checks the result. It exits non-zero on any failure and refuses to run while the container is up. The uploads archive is optional.

### Updating
1. `./scripts/backup.sh`
2. `git pull && docker compose up -d --build`
3. `docker compose logs --tail 50 journal`: look for `FATAL`, and open the app.

Migrations run automatically on start. Before applying any pending migration to an existing database, the app writes a consistent copy to `data/backups/pre-migrate-<timestamp>.db` (the last 3 are kept). A migration that would break foreign-key references is rolled back and stops the app from starting (the database stays at the old version); so does a database that is newer than the code ("database is newer than this version", e.g. after checking out an older version).

**If startup fails with "Could not write the pre-migration backup"** (disk full, or `data/backups` not writable), nothing was migrated and no data was touched. Free some space or fix the permissions of `data/backups` (`chown -R 1000:1000 data`), then `docker compose restart journal`.

**Rollback.** Migrations only go forward; don't just start an old version on a migrated database. `docker compose down`, `git checkout <old version>`, `./scripts/restore.sh backups/journal-STAMP.db [uploads]` (or the `pre-migrate-*.db` copy), then `docker compose up -d --build`.

### Moving to another server
1. Old server: `./scripts/backup.sh`, then copy the newest `journal-STAMP.db` and `uploads-STAMP.tar.gz`, plus your `.env`, to the new server.
2. New server: clone the repo, put the `.env` in place, **don't start it yet**.
3. `./scripts/restore.sh journal-STAMP.db uploads-STAMP.tar.gz` (it creates `./data`), then `docker compose up -d --build`.
4. Point your DNS at the new server, set up the proxy and backups again.

(Copying the raw `data` directory also works, but only with the app stopped, and `journal.db-wal` / `-shm` must come with `journal.db`. The backup script avoids that trap.)

### Known limitations
- Desktop only (a window at least 1024 px wide), tested in Chrome.
- Single user, one password. Times are UTC only. There is no import (export only).
- No built-in HTTPS; use a reverse proxy (Docker path) or an SSH tunnel / private network (SSH path).
- Sessions last 30 days and can only be revoked by changing `SESSION_SECRET` or `APP_PASSWORD` (either one logs everyone out) and restarting.
- One app instance per data directory.

## Development
| Command | What |
|---|---|
| `npm run dev` | Dev server |
| `npm test` | Unit tests (R / stats engine) |
| `npm run typecheck` | TypeScript |
| `npm run lint` | ESLint |
| `npm run build` | Production build |
| `npm run server -- <command>` | Deploy / operate the SSH deployment (`scripts/server.sh`, see [docs/deployment.md](docs/deployment.md)) |
| `npm run db:generate` | Create a migration after changing `src/db/schema.ts` |

Stack: Next.js 16 (App Router, server actions), React 19, Tailwind 4, SQLite (better-sqlite3 + Drizzle), Recharts, zod, jose.

### Backtest scripts
`scripts/` holds a worked example: an H1 hammer / shooting-star + thrust backtest for any coin (BTC, ETH, XAUT, …). See [docs/backtesting.md](docs/backtesting.md).

Contributors and agents: start with [AGENTS.md](AGENTS.md). The pre-launch audit and its known limitations: [docs/launch-audit-2026-10-03.md](docs/launch-audit-2026-10-03.md).

### How R is computed
- `R = (exit − entry) / |entry − stop|` for longs, and the sign is flipped for shorts.
- Planned R:R uses the target instead of the exit.
- Results within the breakeven band (default ±0.1R, set in Settings) count as BE.
- Stats use each idea's primary scenario. The dashboard only counts **taken** trades.
