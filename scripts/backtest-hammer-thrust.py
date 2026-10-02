#!/usr/bin/env python3
"""Mechanical backtest: H1 hammer / shooting star + thrust -> limit at the hammer head (star low), stop beyond the
pattern candle, target = first FTA (nearest confirmed fractal swing). Python 3 stdlib only.

Usage:
  python3 scripts/backtest-hammer-thrust.py                     # primary rules (one position per direction)
  python3 scripts/backtest-hammer-thrust.py --overlap           # allow overlapping signals
  python3 scripts/backtest-hammer-thrust.py --sweep             # print a small rule-sensitivity table
Options: --data scripts/backtest-data/btc-1h.json --out scripts/backtest-data/<symbol>-trades.json --min-rr 1.5
         --from 2026-09-02 --to 2026-10-02 (test window, UTC)

Rules (see the RULES string below, also stored as the setup's rules in the journal).
"""
import argparse, json, sys
from datetime import datetime, timezone

H = 3600_000
WIN_START = int(datetime(2026, 9, 2, tzinfo=timezone.utc).timestamp() * 1000)
WIN_END = int(datetime(2026, 10, 2, tzinfo=timezone.utc).timestamp() * 1000)

RULES = """\
All on 1h candles (UTC). ATR = Wilder ATR(14) of the bar *before* the candle being judged.

1. **Hammer (long)**: lower wick >= 2x body; upper wick <= max(0.5x body, 25% of range); range >= 0.7x ATR;
   after a down move (close < close 3 bars earlier). **Shooting star (short)**: mirror (upper wick >= 2x body,
   lower wick <= max(0.5x body, 25% range), close > close 3 bars earlier).
2. **Thrust**: the first of the next 1-3 candles that closes above the hammer high, is bullish, has body >= 60% of
   its range and range >= 1x ATR. No candle between hammer and thrust may trade below the hammer low (pattern
   failed). Mirror for shooting stars (bearish close below the star low, nothing above the star high in between).
3. **Entry**: limit buy at the hammer high (hammer head), placed at the thrust close, valid 24 bars. Cancel if not
   filled, or if price reaches the TP before filling. If the fill candle also reaches the TP, assume TP came first
   (cancel). Shorts: limit sell at the star low.
4. **Stop**: hammer low - 0.05% (shorts: star high + 0.05%).
5. **TP = first FTA**: nearest (lowest) fractal swing high (high > 3 bars each side, confirmed by thrust close, within
   the last 120 bars) above the thrust high. Fallback: the 120-bar highest high if above the thrust high; else no
   FTA -> no trade. Mirror for shorts (swing lows below the thrust low).
6. **Min R:R**: planned R:R to the FTA < 1.5 -> idea logged as Skipped ("R:R to FTA below 1.5"), outcome still
   simulated.
7. **Exit**: first of stop / target after the fill (the fill candle counts for the stop). Stop and target in the same
   candle -> stop. Still open at 2026-10-02 00:00 UTC -> closed at the last close, reason "time".
8. **One position per direction**: a new signal is ignored while an order/position in the same direction (pending or
   open) exists. Long and short can coexist. Skipped (low-R:R) ideas do not block.
9. **BE-stop alternative**: same entry/target; after a candle's high (low for shorts) reaches +1R the stop moves to
   entry from the *next* candle on (exit at entry, reason "be").
"""


def iso(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def atr_series(c, n=14):
    tr = []
    for i, k in enumerate(c):
        if i == 0:
            tr.append(k["h"] - k["l"])
        else:
            pc = c[i - 1]["c"]
            tr.append(max(k["h"] - k["l"], abs(k["h"] - pc), abs(k["l"] - pc)))
    atr = [None] * len(c)
    if len(c) > n:
        a = sum(tr[1 : n + 1]) / n
        atr[n] = a
        for i in range(n + 1, len(c)):
            a = (a * (n - 1) + tr[i]) / n
            atr[i] = a
    return atr


def daily_bias(c):
    """D1 bias per hour index: last completed daily close vs SMA20 of daily closes (±0.5% band = neutral)."""
    days = {}
    for k in c:
        d = k["t"] // (24 * H)
        days[d] = k["c"]  # last hourly close of the day = daily close
    keys = sorted(days)
    bias = {}
    for idx, d in enumerate(keys):
        if idx < 20:
            continue
        closes = [days[x] for x in keys[idx - 19 : idx + 1]]
        sma = sum(closes) / 20
        cl = days[d]
        bias[d + 1] = "up" if cl > sma * 1.005 else "down" if cl < sma * 0.995 else "flat"  # applies to the next day
    return bias


def is_pivot_high(c, k, w=3):
    return all(c[k]["h"] > c[j]["h"] for j in range(k - w, k + w + 1) if j != k)


def is_pivot_low(c, k, w=3):
    return all(c[k]["l"] < c[j]["l"] for j in range(k - w, k + w + 1) if j != k)


def find_fta(c, j, direction, look=120, w=3):
    """Target known at the close of thrust bar j."""
    lo = max(w, j - look + 1)
    if direction == "long":
        ref = c[j]["h"]
        piv = [c[k]["h"] for k in range(lo, j - w + 1) if is_pivot_high(c, k, w) and c[k]["h"] > ref]
        if piv:
            return min(piv), "swing high"
        hh = max(c[k]["h"] for k in range(lo, j + 1))
        return (hh, "120-bar high") if hh > ref else (None, None)
    ref = c[j]["l"]
    piv = [c[k]["l"] for k in range(lo, j - w + 1) if is_pivot_low(c, k, w) and c[k]["l"] < ref]
    if piv:
        return max(piv), "swing low"
    ll = min(c[k]["l"] for k in range(lo, j + 1))
    return (ll, "120-bar low") if ll < ref else (None, None)


def pattern(c, i, atr, p):
    k = c[i]
    a = atr[i - 1]
    if a is None or i < 3:
        return None
    rng = k["h"] - k["l"]
    if rng <= 0 or rng < p["min_range_atr"] * a:
        return None
    body = abs(k["c"] - k["o"])
    lower = min(k["o"], k["c"]) - k["l"]
    upper = k["h"] - max(k["o"], k["c"])
    if lower >= 2 * body and upper <= max(0.5 * body, 0.25 * rng) and k["c"] < c[i - 3]["c"]:
        return "long"
    if upper >= 2 * body and lower <= max(0.5 * body, 0.25 * rng) and k["c"] > c[i - 3]["c"]:
        return "short"
    return None


def find_thrust(c, i, d, atr, p):
    hk = c[i]
    for j in range(i + 1, min(i + 1 + p["thrust_bars"], len(c))):
        k = c[j]
        a = atr[j - 1]
        rng = k["h"] - k["l"]
        body = abs(k["c"] - k["o"])
        if d == "long":
            if p["intact"] and k["l"] < hk["l"]:
                return None  # pattern failed before a thrust appeared
            ok = k["c"] > hk["h"] and k["c"] > k["o"]
        else:
            if p["intact"] and k["h"] > hk["h"]:
                return None
            ok = k["c"] < hk["l"] and k["c"] < k["o"]
        if ok and rng > 0 and body >= p["thrust_body"] * rng and rng >= p["thrust_atr"] * a:
            return j
    return None


def simulate_exit(c, f, d, entry, stop, target, be_variant=False):
    """From fill bar f. Returns (exit_idx, exit_price, reason). Window end -> 'time' at last in-window close."""
    sign = 1 if d == "long" else -1
    risk = abs(entry - stop)
    cur_stop = stop
    armed = False
    last = max(i for i, k in enumerate(c) if k["t"] < WIN_END)
    for b in range(f, last + 1):
        k = c[b]
        if armed:
            cur_stop = entry
        hit_stop = (k["l"] <= cur_stop) if d == "long" else (k["h"] >= cur_stop)
        hit_tgt = (k["h"] >= target) if d == "long" else (k["l"] <= target)
        if b == f:
            hit_tgt = False  # fill-bar TP touch is treated as "TP before fill" -> handled by the caller
        if hit_stop:
            return b, cur_stop, ("be" if armed else "stop")
        if hit_tgt:
            return b, target, "target"
        if be_variant and not armed:
            fav = k["h"] if d == "long" else k["l"]
            if sign * (fav - entry) >= risk:
                armed = True
    return last, c[last]["c"], "time"


def run(c, p):
    atr = atr_series(c)
    bias = daily_bias(c)
    busy_until = {"long": -1, "short": -1}  # bar index until which a same-direction order/position is active
    trades, notes = [], {"no_fta": 0, "no_fill": 0, "tp_before_fill": 0, "blocked": 0, "patterns": 0, "thrusts": 0}
    last_in = max(i for i, k in enumerate(c) if k["t"] < WIN_END)
    for i in range(20, len(c)):
        d = pattern(c, i, atr, p)
        if not d:
            continue
        j = find_thrust(c, i, d, atr, p)
        if j is None:
            if c[i]["t"] >= WIN_START:
                notes["patterns"] += 1
            continue
        if not (WIN_START <= c[j]["t"] < WIN_END):
            continue
        notes["patterns"] += 1
        notes["thrusts"] += 1
        if not p["overlap"] and j <= busy_until[d]:
            notes["blocked"] += 1
            continue
        hk = c[i]
        entry = hk["h"] if d == "long" else hk["l"]
        stop = hk["l"] * (1 - p["buffer"]) if d == "long" else hk["h"] * (1 + p["buffer"])
        target, fta_src = find_fta(c, j, d, p["fta_look"])
        if target is None:
            notes["no_fta"] += 1
            continue
        risk = abs(entry - stop)
        rr = (target - entry) / risk if d == "long" else (entry - target) / risk
        taken = rr >= p["min_rr"]
        # wait for the fill
        fill, cancel = None, None
        for b in range(j + 1, min(j + 1 + p["valid_bars"], last_in + 1)):
            k = c[b]
            touched = k["l"] <= entry if d == "long" else k["h"] >= entry
            tgt = k["h"] >= target if d == "long" else k["l"] <= target
            if tgt:
                cancel = "tp_before_fill"
                end_b = b
                break
            if touched:
                fill = b
                break
        if fill is None:
            if cancel:
                notes["tp_before_fill"] += 1
            else:
                notes["no_fill"] += 1
                end_b = min(j + p["valid_bars"], last_in)
            if taken:
                busy_until[d] = max(busy_until[d], end_b)
            continue
        xb, xp, reason = simulate_exit(c, fill, d, entry, stop, target)
        bxb, bxp, breason = simulate_exit(c, fill, d, entry, stop, target, be_variant=True)
        sign = 1 if d == "long" else -1
        r = sign * (xp - entry) / risk
        br = sign * (bxp - entry) / risk
        if taken:
            busy_until[d] = max(busy_until[d], xb)
        db = bias.get(c[fill]["t"] // (24 * H))
        htf = None if db is None else ("neutral" if db == "flat" else "with" if (db == "up") == (d == "long") else "against")
        trades.append(
            dict(
                direction=d,
                pattern="Hammer" if d == "long" else "Shooting star",
                pattern_t=iso(c[i]["t"]),
                thrust_t=iso(c[j]["t"]),
                fill_t=iso(c[fill]["t"]),
                exit_t=iso(WIN_END) if reason == "time" else iso(c[xb]["t"]),
                be_exit_t=iso(WIN_END) if breason == "time" else iso(c[bxb]["t"]),
                pat=dict(o=hk["o"], h=hk["h"], l=hk["l"], c=hk["c"]),
                thrust=dict(o=c[j]["o"], h=c[j]["h"], l=c[j]["l"], c=c[j]["c"]),
                atr=round(atr[i - 1], 1),
                entry=entry,
                stop=round(stop, 1),
                target=target,
                fta_src=fta_src,
                rr=round(rr, 2),
                exit=round(xp, 1),
                reason=reason,
                r=round(r, 3),
                be_exit=round(bxp, 1),
                be_reason=breason,
                be_r=round(br, 3),
                status="taken" if taken else "skipped",
                htf_bias=htf,
                bars_to_fill=fill - j,
                bars_held=xb - fill,
            )
        )
    return trades, notes


def stats(rs):
    if not rs:
        return dict(n=0)
    wins = [r for r in rs if r > 0.1]
    losses = [r for r in rs if r < -0.1]
    eq = peak = dd = 0
    for r in rs:
        eq += r
        peak = max(peak, eq)
        dd = max(dd, peak - eq)
    return dict(
        n=len(rs),
        wins=len(wins),
        losses=len(losses),
        be=len(rs) - len(wins) - len(losses),
        win_rate=round(len(wins) / len(rs), 3),
        expectancy=round(sum(rs) / len(rs), 3),
        total=round(sum(rs), 2),
        pf=round(sum(wins) / -sum(losses), 2) if losses else None,
        max_dd=round(dd, 2),
    )


DEFAULTS = dict(min_range_atr=0.7, thrust_bars=3, thrust_body=0.6, thrust_atr=1.0, valid_bars=24, buffer=0.0005, fta_look=120, min_rr=1.5, overlap=False, intact=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="scripts/backtest-data/btc-1h.json")
    ap.add_argument("--out")
    ap.add_argument("--from", dest="win_from", default="2026-09-02")
    ap.add_argument("--to", dest="win_to", default="2026-10-02")
    ap.add_argument("--min-rr", type=float, default=1.5)
    ap.add_argument("--overlap", action="store_true")
    ap.add_argument("--sweep", action="store_true")
    a = ap.parse_args()
    raw = json.load(open(a.data))
    c = raw["candles"]
    symbol = raw.get("symbol", "BTC")
    out_path = a.out or f"scripts/backtest-data/{symbol.lower()}-trades.json"
    global WIN_START, WIN_END
    day = lambda d: int(datetime.strptime(d, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp() * 1000)
    WIN_START, WIN_END = day(a.win_from), day(a.win_to)
    p = dict(DEFAULTS, min_rr=a.min_rr, overlap=a.overlap)
    if a.sweep:
        variants = [
            ("baseline", {}),
            ("overlap allowed", dict(overlap=True)),
            ("min R:R 1.0", dict(min_rr=1.0)),
            ("min R:R 2.0", dict(min_rr=2.0)),
            ("no min R:R", dict(min_rr=-99)),
            ("thrust body>=50%, range>=0.8 ATR", dict(thrust_body=0.5, thrust_atr=0.8)),
            ("thrust body>=70%, range>=1.2 ATR", dict(thrust_body=0.7, thrust_atr=1.2)),
            ("thrust within 1 bar only", dict(thrust_bars=1)),
            ("pattern range>=1.0 ATR", dict(min_range_atr=1.0)),
            ("pattern range>=0.5 ATR", dict(min_range_atr=0.5)),
            ("allow hammer low broken before thrust", dict(intact=False)),
            ("loose thrust + overlap", dict(thrust_body=0.5, thrust_atr=0.8, overlap=True)),
            ("FTA lookback 60", dict(fta_look=60)),
            ("FTA lookback 240", dict(fta_look=240)),
            ("order valid 12 bars", dict(valid_bars=12)),
            ("stop buffer 0.2%", dict(buffer=0.002)),
        ]
        print(f"{'variant':38} {'taken':>5} {'WR':>5} {'expR':>6} {'totR':>6} {'PF':>5} {'DD':>5} | {'BE totR':>7} | {'all ideas totR':>14} n")
        for name, over in variants:
            t, _ = run(c, dict(p, **over))
            tk = [x for x in t if x["status"] == "taken"]
            s = stats([x["r"] for x in tk])
            sb = stats([x["be_r"] for x in tk])
            sa = stats([x["r"] for x in t])
            print(f"{name:38} {s.get('n',0):>5} {s.get('win_rate',0):>5} {s.get('expectancy',0):>6} {s.get('total',0):>6} {str(s.get('pf')):>5} {s.get('max_dd',0):>5} | {sb.get('total',0):>7} | {sa.get('total',0):>14} {sa.get('n',0)}")
        return
    trades, notes = run(c, p)
    tk = [x for x in trades if x["status"] == "taken"]
    sk = [x for x in trades if x["status"] == "skipped"]
    summary = dict(
        symbol=symbol,
        source=raw["source"],
        candles_total=len(c),
        candles_in_window=sum(1 for k in c if WIN_START <= k["t"] < WIN_END),
        params=p,
        notes=notes,
        taken=stats([x["r"] for x in tk]),
        taken_be_variant=stats([x["be_r"] for x in tk]),
        longs=stats([x["r"] for x in tk if x["direction"] == "long"]),
        shorts=stats([x["r"] for x in tk if x["direction"] == "short"]),
        skipped=stats([x["r"] for x in sk]),
    )
    json.dump(dict(summary=summary, rules=RULES, trades=trades), open(out_path, "w"), indent=1)
    print(json.dumps(summary, indent=1))
    print()
    print(f"{'#':>2} {'dir':5} {'pattern':16} {'fill':16} {'entry':>8} {'stop':>8} {'target':>8} {'RR':>5} {'exit_t':16} {'exit':>8} {'why':6} {'R':>6} {'BE_R':>6} status")
    for n, x in enumerate(trades, 1):
        print(f"{n:>2} {x['direction']:5} {x['pattern_t'][5:16]:16} {x['fill_t'][5:16]:16} {x['entry']:>8} {x['stop']:>8} {x['target']:>8} {x['rr']:>5} {x['exit_t'][5:16]:16} {x['exit']:>8} {x['reason']:6} {x['r']:>6} {x['be_r']:>6} {x['status']}")


if __name__ == "__main__":
    main()
