# Backtesting

All scripts are Python 3 stdlib only, run from the `edge-journal/` folder.

## Pipeline
```bash
python3 scripts/fetch-1h.py --symbol ETH
```
This fetches 1h candles to `scripts/backtest-data/eth-1h.json`.
```bash
python3 scripts/backtest-hammer-thrust.py --data scripts/backtest-data/eth-1h.json
```
This writes `scripts/backtest-data/eth-trades.json`.
```bash
python3 scripts/import-hammer-thrust.py --trades scripts/backtest-data/eth-trades.json --db .data-backtest/journal.db
```
This imports the trades into the journal DB.

- **fetch-1h.py**
  - `--symbol` is the symbol recorded in the journal.
  - `--coin` is the Hyperliquid market name when it differs from the symbol:
    - perp names like `BTC`, `ETH`, `PAXG`;
    - spot pairs as `@<index>` (XAUT0/USDC is `@182`);
    - HIP-3 markets like `xyz:GOLD`.
  - Defaults: `--start 2026-07-20 --end 2026-10-02`. Fetch about 6 weeks before the test window, for swing and ATR context.
  - Plain tickers fall back to Bybit, then OKX, then Binance.
- **backtest-hammer-thrust.py**
  - `--from` / `--to` set the test window.
  - `--min-rr` (default 1.5): below it, a trade is recorded as *skipped* with its hypothetical outcome.
  - `--overlap` allows overlapping positions.
  - `--sweep` runs a rule-sensitivity table.
  - The rules are in the `RULES` string at the top of the script.
- **import-hammer-thrust.py**
  - Taken trades become status **`backtest`**; skipped ones stay `skipped`.
  - It adds a **BE stop** alternative to each backtest trade.
  - It tags trades with Candle (Hammer or Shooting star, plus Thrust) and Context: Weekend.
  - It is idempotent: duplicates are detected by setup + symbol + direction + opened_at.
  - It requires the setup (default `"H1 hammer + thrust → bid head"`) to already exist in that DB.

## Setup rules implemented (H1 hammer / shooting star + thrust)
- **Pattern:**
  - Hammer: lower wick ≥ 2× body; upper wick ≤ max(0.5× body, 25% of range); range ≥ 0.7× ATR(14).
  - It must follow a down move: close < close 3 bars earlier.
  - Shooting star is the mirror image.
- **Thrust:** within 1–3 bars, a candle closes beyond the pattern. It needs body ≥ 60% of its range and range ≥ 1× ATR, and the pattern extreme must not be traded through before the thrust.
- **Entry:** limit at the hammer high (star low), valid 24 bars. It's cancelled if price hits the target first.
- **Stop:** pattern extreme ± 0.05%.
- **Target:** first FTA, the nearest confirmed 3-bar fractal within 120 bars.

## Separate backtest instance
Keep backtests in their own data dir so they never touch real data. Run the standalone build on port 3200:
1. Build and copy the assets:
   ```bash
   npm run build && cp -r .next/static .next/standalone/.next/static && cp -r drizzle .next/standalone/drizzle
   ```
2. Start the server from the standalone folder:
   ```bash
   cd .next/standalone && set -a && . ../../.env.local && set +a && PORT=3200 HOSTNAME=127.0.0.1 DATA_DIR=$PWD/../../.data-backtest COOKIE_SECURE=false NODE_ENV=production node server.js
   ```

## Results so far (2026-09-02 → 10-02, 1h)
| Coin | Data | Taken | Win rate | Total R | BE-stop total | Skipped (hypothetical) |
|---|---|---|---|---|---|---|
| BTC | HL BTC perp | 2 | 100% | +4.48 | +4.48 | 1, +0.83R |
| ETH | HL ETH perp | 2 | 50% | +1.25 | −1.00 | 2, +1.65R |
| XAUT | HL XAUT0/USDC spot (thin liquidity) | 3 | 33% | +0.64 | 0.00 | 2, +0.47R |

7 trades in total. That is far too few for a conclusion. The next step is 1–2 years of data per coin.
