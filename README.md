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
- **Exit types.** Alternatives can be marked **Not filled** (counts as 0R), so limit-entry variants like "wick entry" are judged fairly.
- **Prices** accept `64,250`, `64250.5` or `1.234,5`. The parsed number is echoed under the field.
- **Times** are always UTC: stored, entered and shown in UTC, and not configurable.
- **Screenshots.** Paste (⌘V), drag and drop, or browse.
- **Export.** Trades as CSV, everything as JSON, or a raw SQLite backup.
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

## Deploy on your server (Docker)
```bash
git clone <this repo> edge-journal
```
```bash
cd edge-journal && cp .env.example .env
```
Edit `.env` and set `APP_PASSWORD` plus a long random `SESSION_SECRET` (`openssl rand -hex 32`). Then:
```bash
docker compose up -d --build
```
The app listens on `127.0.0.1:3000`. Data (DB + screenshots) lives in `./data` on the host.

### HTTPS
Put a reverse proxy in front. With Caddy (`/etc/caddy/Caddyfile`):
```
journal.example.com {
  reverse_proxy 127.0.0.1:3000
}
```
Session cookies are `Secure` in production, so serve the app over HTTPS. If you really must use plain HTTP (e.g. a private LAN), set `COOKIE_SECURE=false`; any other value (`0`, `no`, a typo) keeps `Secure` on. `SESSION_SECRET` (32+ chars) is required whenever `NODE_ENV` is not `development`: without it, login fails instead of falling back to a public key. Your proxy must overwrite `X-Forwarded-For` (Caddy does) because the login throttle trusts it.

### Backups
```bash
./scripts/backup.sh
```
This writes a consistent SQLite snapshot plus a tarball of screenshots to `./backups` and keeps the last 30. Add it to cron, for example daily at 03:00:
```
0 3 * * * /path/to/edge-journal/scripts/backup.sh
```
You can also download a backup any time from **Settings → Export & backup**.

### Updating
```bash
git pull && docker compose up -d --build
```
Database migrations run automatically on start.

## Development
| Command | What |
|---|---|
| `npm run dev` | Dev server |
| `npm test` | Unit tests (R / stats engine) |
| `npm run typecheck` | TypeScript |
| `npm run lint` | ESLint |
| `npm run build` | Production build |
| `npm run db:generate` | Create a migration after changing `src/db/schema.ts` |

Stack: Next.js 16 (App Router, server actions), React 19, Tailwind 4, SQLite (better-sqlite3 + Drizzle), Recharts, zod, jose.

### Backtest scripts
`scripts/` holds a worked example: an H1 hammer / shooting-star + thrust backtest for any coin (BTC, ETH, XAUT, …). See [docs/backtesting.md](docs/backtesting.md).

Contributors and agents: start with [AGENTS.md](AGENTS.md).

### How R is computed
- `R = (exit − entry) / |entry − stop|` for longs, and the sign is flipped for shorts.
- Planned R:R uses the target instead of the exit.
- Results within the breakeven band (default ±0.1R, set in Settings) count as BE.
- Stats use each idea's primary scenario. The dashboard only counts **taken** trades.
