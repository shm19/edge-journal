#!/usr/bin/env python3
"""Fetch 1h candles for any coin (Hyperliquid first, then Bybit / OKX / Binance fallbacks).

Usage:
  python3 scripts/fetch-1h.py --symbol BTC                      # BTC perp
  python3 scripts/fetch-1h.py --symbol ETH                      # ETH perp
  python3 scripts/fetch-1h.py --symbol XAUT --coin @182         # XAUT0/USDC spot on Hyperliquid
  python3 scripts/fetch-1h.py --symbol XAUT --coin PAXG         # gold proxy: PAXG perp (more liquid)
Options: --start 2026-07-20 --end 2026-10-02 --out scripts/backtest-data/<symbol>-1h.json
`--coin` is the Hyperliquid market name (perp name, "@<index>" for spot, "xyz:GOLD" for HIP-3); defaults to --symbol.
Output JSON: {"source": ..., "symbol": ..., "interval": "1h", "candles": [{"t": ms_open, "o","h","l","c","v"}...]}
"""
import argparse, json, time, urllib.request, urllib.error
from datetime import datetime, timezone

H = 3600_000


def ms(d):
    return int(datetime.strptime(d, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp() * 1000)


def req(url, body=None, tries=6, timeout=20):
    last = None
    for i in range(tries):
        try:
            data = json.dumps(body).encode() if body is not None else None
            r = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json", "User-Agent": "edge-journal-backtest/1.0"})
            with urllib.request.urlopen(r, timeout=timeout) as resp:
                return json.loads(resp.read().decode())
        except Exception as e:  # flaky network: retry with backoff
            last = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"{url}: {last}")


def hyperliquid(start, end, coin):
    out = {}
    cur = start
    while cur < end:
        chunk_end = min(end, cur + 400 * H)
        rows = req("https://api.hyperliquid.xyz/info", {"type": "candleSnapshot", "req": {"coin": coin, "interval": "1h", "startTime": cur, "endTime": chunk_end}})
        for r in rows:
            out[int(r["t"])] = {"t": int(r["t"]), "o": float(r["o"]), "h": float(r["h"]), "l": float(r["l"]), "c": float(r["c"]), "v": float(r["v"])}
        cur = chunk_end
    kind = "spot" if coin.startswith("@") else "HIP-3 perp" if ":" in coin else "perp"
    return f"hyperliquid {coin} {kind} (api.hyperliquid.xyz candleSnapshot)", out


def bybit(start, end, base):
    out = {}
    cur_end = end
    while cur_end > start:
        d = req(f"https://api.bybit.com/v5/market/kline?category=linear&symbol={base}USDT&interval=60&start={start}&end={cur_end}&limit=1000")
        rows = d["result"]["list"]
        if not rows:
            break
        for r in rows:
            t = int(r[0])
            out[t] = {"t": t, "o": float(r[1]), "h": float(r[2]), "l": float(r[3]), "c": float(r[4]), "v": float(r[5])}
        oldest = min(int(r[0]) for r in rows)
        if oldest <= start:
            break
        cur_end = oldest - 1
    return f"bybit {base}USDT linear perp", out


def okx(start, end, base):
    out = {}
    after = end
    while True:
        d = req(f"https://www.okx.com/api/v5/market/history-candles?instId={base}-USDT-SWAP&bar=1H&after={after}&limit=100")
        rows = d.get("data", [])
        if not rows:
            break
        for r in rows:
            t = int(r[0])
            out[t] = {"t": t, "o": float(r[1]), "h": float(r[2]), "l": float(r[3]), "c": float(r[4]), "v": float(r[5])}
        oldest = min(int(r[0]) for r in rows)
        if oldest <= start:
            break
        after = oldest
    return f"okx {base}-USDT-SWAP", out


def binance(start, end, base):
    out = {}
    cur = start
    while cur < end:
        rows = req(f"https://api.binance.com/api/v3/klines?symbol={base}USDT&interval=1h&startTime={cur}&endTime={end}&limit=1000")
        if not rows:
            break
        for r in rows:
            t = int(r[0])
            out[t] = {"t": t, "o": float(r[1]), "h": float(r[2]), "l": float(r[3]), "c": float(r[4]), "v": float(r[5])}
        cur = int(rows[-1][0]) + H
    return f"binance {base}USDT spot", out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbol", default="BTC", help="symbol to record in the journal, e.g. BTC, ETH, XAUT")
    ap.add_argument("--coin", help="Hyperliquid market name if different from --symbol (e.g. @182, PAXG, xyz:GOLD)")
    ap.add_argument("--start", default="2026-07-20")
    ap.add_argument("--end", default="2026-10-02")
    ap.add_argument("--out")
    a = ap.parse_args()
    symbol = a.symbol.upper()
    coin = a.coin or symbol
    out_path = a.out or f"scripts/backtest-data/{symbol.lower()}-1h.json"
    start, end = ms(a.start), ms(a.end)
    sources = [lambda s, e: hyperliquid(s, e, coin)]
    if not a.coin:  # CEX fallbacks only make sense for plain tickers
        sources += [lambda s, e, f=f: f(s, e, symbol) for f in (bybit, okx, binance)]
    for fn in sources:
        try:
            src, rows = fn(start, end)
            candles = [rows[t] for t in sorted(rows) if start <= t < end]
            if len(candles) < (end - start) // H * 0.95:
                print(f"{src}: only {len(candles)} candles, trying next source")
                continue
            json.dump({"source": src, "symbol": symbol, "interval": "1h", "fetched_at": datetime.now(timezone.utc).isoformat(), "candles": candles}, open(out_path, "w"))
            print(f"{src}: {len(candles)} candles {datetime.fromtimestamp(candles[0]['t']/1000, timezone.utc)} -> {datetime.fromtimestamp(candles[-1]['t']/1000, timezone.utc)} -> {out_path}")
            return
        except Exception as e:
            print(f"source failed: {e}")
    raise SystemExit("all sources failed")


if __name__ == "__main__":
    main()
