import type { IdeaStatus } from "@/db/schema";
import { STATUS_LABEL, fmtDate, fmtMoney, fmtPctPoints, fmtR } from "@/lib/format";
import type { SimResult } from "@/lib/stats";
import { RValue, StatusBadge, Kpi, SampleBadge } from "./bits";
import { EquityChart } from "./charts";
import { Card, CardHeader } from "./ui";

export const HYPOTHETICAL_NOTE = "Hypothetical: assumes the stated risk on every trade; not your real account";

export interface TradeMeta {
  setup: string;
  status: IdeaStatus;
}

/** Output of the balance simulator: warnings, KPIs, $ curve and the per-trade table. Static, so server-renderable. */
export function BalanceResults({
  sim,
  meta,
  statuses,
  defaultRiskPct,
  useTradeRisk,
}: {
  sim: SimResult;
  meta: Record<number, TradeMeta>;
  /** Statuses the simulated ideas are drawn from (the filter); anything but taken is labelled as not live. */
  statuses: IdeaStatus[];
  defaultRiskPct: number;
  useTradeRisk: boolean;
}) {
  const n = sim.trades.length + sim.skippedAfterRuin;
  const notLive = statuses.some((s) => s !== "taken");
  const mixed = notLive && statuses.includes("taken");
  const totalR = sim.trades.reduce((a, t) => a + t.r, 0);
  const avgRisk = sim.trades.length ? sim.trades.reduce((a, t) => a + t.riskPct, 0) / sim.trades.length : 0;
  const riskSub = useTradeRisk ? `avg ${+avgRisk.toFixed(2)}% risk` : `${defaultRiskPct}% risk per trade`;
  const curve = sim.trades.map((t, i) => ({ n: i + 1, cum: t.balance, label: `${fmtDate(t.date)} · ${fmtMoney(t.balance)}` }));
  return (
    <div className="space-y-4" aria-live="polite">
      <p className="rounded-lg border border-line bg-panel px-3 py-2 text-xs text-muted">{HYPOTHETICAL_NOTE}.</p>
      {notLive && (
        <p className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-xs text-warn">
          {mixed ? "Mixed statuses — not live results" : "Not live results"}: this simulates {statuses.map((s) => STATUS_LABEL[s]).join(", ")} ideas, not trades you took with real money.
        </p>
      )}
      {n === 0 ? (
        <p className="rounded-lg border border-line bg-panel px-3 py-6 text-center text-sm text-faint">No closed trades match these filters.</p>
      ) : (
        <>
          {n < 20 && (
            <p className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-xs text-warn">
              Only {n} closed trade{n === 1 ? "" : "s"} — these numbers are too few to trust until you have 20+.
            </p>
          )}
          {sim.ruined && (
            <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/[0.07] px-3 py-2 text-xs text-loss">
              The balance reached $0 after trade {sim.trades.length}; the account is wiped out in this simulation
              {sim.skippedAfterRuin > 0 ? ` and the remaining ${sim.skippedAfterRuin} trade${sim.skippedAfterRuin === 1 ? " is" : "s are"} not simulated` : ""}.
            </p>
          )}
          {sim.fallbackCount > 0 && (
            <p className="rounded-lg border border-line bg-panel px-3 py-2 text-xs text-muted">
              {sim.fallbackCount} trade{sim.fallbackCount === 1 ? " has" : "s have"} no recorded risk and used the {defaultRiskPct}% default.
            </p>
          )}
          <div className="grid grid-cols-5 gap-3">
            <Kpi label="Ending balance (simulated)" value={fmtMoney(sim.end)} sub={<>from {fmtMoney(sim.start)} · <SampleBadge n={n} /></>} />
            <Kpi
              label="P/L"
              value={<span className={sim.pnl > 0 ? "text-win" : sim.pnl < 0 ? "text-loss" : undefined}>{fmtMoney(sim.pnl, true)}</span>}
              sub={
                <>
                  {fmtPctPoints(sim.returnPct)} return
                  <br />
                  {fmtR(totalR)} total · {riskSub}
                </>
              }
            />
            <Kpi
              label="Max drawdown"
              value={<span className={sim.maxDrawdown > 0 ? "text-loss" : "text-faint"}>{sim.maxDrawdown > 0 ? `-${fmtMoney(sim.maxDrawdown)}` : fmtMoney(0)}</span>}
              sub={`${sim.maxDrawdownPct.toFixed(2)}% from peak`}
            />
            <Kpi label="Largest win" value={<span className="text-win">{fmtMoney(sim.largestWin, true)}</span>} />
            <Kpi label="Largest loss" value={<span className="text-loss">{fmtMoney(sim.largestLoss, true)}</span>} />
          </div>
          <Card>
            <CardHeader title="Balance curve ($)" description="Hypothetical balance after each closed trade, in order." />
            <div className="px-2 pb-3">
              <p className="sr-only">
                Balance from {fmtMoney(sim.start)} to {fmtMoney(sim.end)} after {sim.trades.length} trade{sim.trades.length === 1 ? "" : "s"}
              </p>
              <EquityChart data={curve} money base={sim.start} />
            </div>
          </Card>
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <caption className="sr-only">Simulated result of each trade</caption>
              <thead className="bg-panel">
                <tr className="text-left text-[11px] uppercase tracking-wider text-faint">
                  <th scope="col" className="px-3 py-2.5 font-medium">Date</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Setup</th>
                  {notLive && <th scope="col" className="px-3 py-2.5 font-medium">Status</th>}
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">R</th>
                  {useTradeRisk && <th scope="col" className="px-3 py-2.5 text-right font-medium">Risk</th>}
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">P/L</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Balance after</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {sim.trades.map((t) => (
                  <tr key={t.id} className="border-t border-line">
                    <td className="px-3 py-2">{fmtDate(t.date)}</td>
                    <td className="px-3 py-2">{meta[t.id]?.setup}</td>
                    {notLive && <td className="px-3 py-2">{meta[t.id] && <StatusBadge status={meta[t.id].status} />}</td>}
                    <td className="px-3 py-2 text-right"><RValue r={t.r} be={0} /></td>
                    {useTradeRisk && <td className="px-3 py-2 text-right text-muted">{t.riskPct}%{t.fallback ? " (default)" : ""}</td>}
                    <td className={`px-3 py-2 text-right ${t.pnl > 0 ? "text-win" : t.pnl < 0 ? "text-loss" : ""}`}>{fmtMoney(t.pnl, true)}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(t.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
