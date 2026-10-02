#!/usr/bin/env python3
"""Write the backtest trades (scripts/backtest-data/<symbol>-trades.json) into an Edge Journal SQLite DB, shaped exactly like
rows created through the idea editor (ISO timestamps with ms + Z, booleans 0/1, JSON text columns).

Usage:
  python3 scripts/import-hammer-thrust.py --print 1            # print the editor texts for trade #1 (for manual UI entry)
  python3 scripts/import-hammer-thrust.py --db .data-backtest/journal.db --setup "H1 hammer + thrust → bid head" [--dry-run]

Idempotent: a trade is skipped if an idea with the same setup, direction and opened_at already exists
(so the trades entered by hand through the UI are not inserted twice).
"""
import argparse, json, sqlite3
from datetime import datetime, timezone


def fmt_t(s):
    return s[:16].replace("T", " ") + " UTC"


def p(x):
    return f"{x:.1f}".rstrip("0").rstrip(".")


def texts(t, symbol="BTC", source=""):
    long = t["direction"] == "long"
    pat, th = t["pat"], t["thrust"]
    name = t["pattern"]
    lvl = "hammer head" if long else "star low"
    side = "above the hammer high" if long else "below the star low"
    risk = abs(t["entry"] - t["stop"])
    one_r = t["entry"] + risk if long else t["entry"] - risk
    thesis = "\n".join(
        [
            f"Mechanical backtest (scripts/backtest-hammer-thrust.py), {symbol} 1h" + (f" — data: {source}." if source else "."),
            f"- **{name}** {fmt_t(t['pattern_t'])}: O {p(pat['o'])} H {p(pat['h'])} L {p(pat['l'])} C {p(pat['c'])} (ATR14 {p(t['atr'])})",
            f"- **Thrust** {fmt_t(t['thrust_t'])}: closed {p(th['c'])} {side}, range {p(th['h'] - th['l'])}",
            f"- Limit {'buy' if long else 'sell'} at the {lvl} {p(t['entry'])}, stop {p(t['stop'])} ({'hammer low − 0.05%' if long else 'star high + 0.05%'})",
            f"- FTA: {t['fta_src']} {p(t['target'])} → planned R:R {t['rr']:.2f}",
            f"- {'Would have filled' if t['status'] == 'skipped' else 'Filled'} {fmt_t(t['fill_t'])} ({t['bars_to_fill']} bar{'s' if t['bars_to_fill'] != 1 else ''} after the thrust)",
        ]
    )
    invalidation = f"Price trades {'below the hammer low' if long else 'above the star high'} {p(pat['l'] if long else pat['h'])} (stop {p(t['stop'])})."
    reason_txt = {"target": "target (FTA)", "stop": "stopped", "time": "window end (time)", "be": "breakeven"}[t["reason"]]
    review = (
        f"{'Hypothetical exit' if t['status'] == 'skipped' else 'Exit'}: {reason_txt} {p(t['exit'])} at {fmt_t(t['exit_t'])} "
        f"after {t['bars_held']} bars → {t['r']:+.2f}R. BE-stop variant: {t['be_reason']} → {t['be_r']:+.2f}R."
    )
    alt_note = f"Stop moved to entry from the candle after +1R ({p(one_r)}) was reached."
    return dict(thesis=thesis, invalidation=invalidation, review=review, alt_note=alt_note, skip_reason="R:R to FTA below 1.5")


def is_weekend(iso):
    return datetime.strptime(iso[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc).weekday() >= 5


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--trades", required=True, help="e.g. scripts/backtest-data/eth-trades.json")
    ap.add_argument("--db", default=".data-backtest/journal.db")
    ap.add_argument("--setup", default="H1 hammer + thrust → bid head")
    ap.add_argument("--print", type=int, dest="show")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    data = json.load(open(a.trades))
    trades = data["trades"]
    symbol = data.get("summary", {}).get("symbol", "BTC")
    source = data.get("summary", {}).get("source", "")
    if a.show:
        t = trades[a.show - 1]
        print(json.dumps(dict(trade=t, **texts(t, symbol, source)), indent=1, ensure_ascii=False))
        return

    con = sqlite3.connect(a.db, timeout=10)
    con.execute("PRAGMA foreign_keys = ON")
    cur = con.cursor()
    row = cur.execute("SELECT id, checklist FROM setups WHERE name = ?", (a.setup,)).fetchone()
    if not row:
        raise SystemExit(f"setup {a.setup!r} not found — create it in the UI first")
    setup_id, checklist = row[0], json.loads(row[1])
    tag = {f"{g}:{n}": i for i, n, g in cur.execute('SELECT id, name, "group" FROM tags')}
    be_type = cur.execute("SELECT id FROM scenario_types WHERE name = 'BE stop'").fetchone()[0]
    risk_pct = float(dict(cur.execute("SELECT key, value FROM settings").fetchall()).get("defaultRiskPct", "1"))

    inserted = skipped = 0
    for n, t in enumerate(trades, 1):
        if cur.execute(
            "SELECT 1 FROM ideas WHERE setup_id = ? AND symbol = ? AND direction = ? AND opened_at = ?", (setup_id, symbol, t["direction"], t["fill_t"])
        ).fetchone():
            print(f"#{n} already in the journal ({t['fill_t']}), skipping")
            skipped += 1
            continue
        tx = texts(t, symbol, source)
        taken = t["status"] == "taken"
        # Checklist: everything passes except the R:R check on skipped ideas. The editor only stores ticked items.
        state = {item: True for item in checklist if taken or "R:R" not in item}
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{datetime.now(timezone.utc).microsecond // 1000:03d}Z"
        cur.execute(
            """INSERT INTO ideas (symbol, direction, status, setup_id, entry_timeframe, htf_bias, regime, opened_at, closed_at,
                 thesis, invalidation, skip_reason, review, followed_plan, risk_pct, fees_usd, pnl_usd, checklist_state, confidence,
                 created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                symbol,
                t["direction"],
                "backtest" if taken else t["status"],  # backtests never mix into live stats
                setup_id,
                "1h",
                t["htf_bias"],
                None,
                t["fill_t"],
                t["exit_t"],
                tx["thesis"],
                tx["invalidation"],
                "" if taken else tx["skip_reason"],
                tx["review"],
                1 if taken else None,
                risk_pct,  # the editor pre-fills the default risk % for every status
                None,
                None,
                json.dumps(state, ensure_ascii=False, separators=(",", ":")),
                None,
                now,
                now,
            ),
        )
        idea_id = cur.lastrowid
        cur.execute(
            "INSERT INTO scenarios (idea_id, scenario_type_id, is_primary, entry, stop, target, exit_price, exit_reason, notes) VALUES (?,?,?,?,?,?,?,?,?)",
            (idea_id, None, 1, t["entry"], t["stop"], t["target"], t["exit"], t["reason"], ""),
        )
        if taken:  # BE-stop alternative only for taken trades
          cur.execute(
            "INSERT INTO scenarios (idea_id, scenario_type_id, is_primary, entry, stop, target, exit_price, exit_reason, notes) VALUES (?,?,?,?,?,?,?,?,?)",
            (idea_id, be_type, 0, t["entry"], t["stop"], t["target"], t["be_exit"], t["be_reason"], tx["alt_note"]),
        )
        tags = ["Candle:" + t["pattern"], "Candle:Thrust"] + (["Context:Weekend"] if is_weekend(t["fill_t"]) else [])
        for k in tags:
            cur.execute("INSERT INTO idea_tags (idea_id, tag_id) VALUES (?, ?)", (idea_id, tag[k]))
        inserted += 1
        print(f"#{n} inserted as idea {idea_id} ({t['status']} {t['direction']} {t['fill_t']})")
    if a.dry_run:
        con.rollback()
        print("dry run — rolled back")
    else:
        con.commit()
    print(f"inserted {inserted}, already present {skipped}")


if __name__ == "__main__":
    main()
