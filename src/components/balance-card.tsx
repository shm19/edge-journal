"use client";

import Link from "next/link";
import { balanceQuery, parseBalanceParams, simOptions } from "@/lib/balance";
import { useStoredBalance } from "@/lib/balance-store";
import { fmtMoney, fmtPctPoints } from "@/lib/format";
import { simulateBalance, type SimPoint } from "@/lib/stats";
import { SampleBadge } from "./bits";

/**
 * "Balance sim" row of the dashboard's At a glance card: the last-used simulator inputs (or the defaults) over ALL
 * closed TAKEN trades, independent of the 7D/30D selector. `points` are plain data so they can cross the server/client
 * boundary. Renders a <div> row to sit inside the card's <dl>.
 */
export function BalanceCard({ points, defaultRiskPct }: { points: SimPoint[]; defaultRiskPct: number }) {
  const stored = useStoredBalance();
  // A stored value that no longer validates is ignored here (the tab itself always shows the error).
  const parsed = parseBalanceParams(Object.fromEntries(new URLSearchParams(stored)), defaultRiskPct);
  const { inputs } = Object.keys(parsed.errors).length ? parseBalanceParams({}, defaultRiskPct) : parsed;
  const sim = simulateBalance(points, simOptions(inputs));
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <dt className="whitespace-nowrap text-muted">Balance sim</dt>
        <dd className="tabular">
          {sim.trades.length === 0 ? (
            <span className="text-faint">No closed taken trades yet</span>
          ) : (
            <>
              {fmtMoney(sim.start)} → {fmtMoney(sim.end)}{" "}
              <span className={sim.pnl > 0 ? "text-win" : sim.pnl < 0 ? "text-loss" : "text-be"}>({fmtPctPoints(sim.returnPct)})</span>
            </>
          )}
          {" "}
          <Link href={`/analytics?tab=balance&${balanceQuery(inputs)}`} className="text-xs text-accent">
            Simulate →
          </Link>
        </dd>
      </div>
      <p className="mt-0.5 text-xs text-faint">
        Hypothetical, not your account · all time, taken trades (ignores the 7D/30D selector) · your last simulator settings
        {sim.trades.length > 0 && (
          <>
            {" "}· {inputs.useTradeRisk ? "each trade's own risk" : `${inputs.riskPct}% risk`}, {inputs.mode} · <SampleBadge n={points.length} />
          </>
        )}
        {sim.ruined && <span className="text-loss"> · account wiped out</span>}
      </p>
    </div>
  );
}
