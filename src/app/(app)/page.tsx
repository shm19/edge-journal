import { Plus } from "lucide-react";
import Link from "next/link";
import { Kpi, RValue, SampleBadge, SetupBadge } from "@/components/bits";
import { EquityChart, RHistogram } from "@/components/charts";
import { IdeaTable } from "@/components/idea-table";
import { Card, CardHeader, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { cn } from "@/lib/cn";
import { fmtDate, fmtNum, fmtPct, fmtR } from "@/lib/format";
import { loadIdeas, mistakeSummary, observationStats, primaryPoints } from "@/lib/queries";
import { getSettings } from "@/lib/settings";
import { equityCurve, groupSummaries, summarize } from "@/lib/stats";

export const metadata = { title: "Dashboard" };

const RANGES = [
  { key: "7d", label: "7D", days: 7 },
  { key: "30d", label: "30D", days: 30 },
  { key: "90d", label: "90D", days: 90 },
  { key: "ytd", label: "YTD", days: null },
  { key: "all", label: "All", days: null },
] as const;

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const { range = "all" } = await searchParams;
  const { beThresholdR: be } = getSettings();
  const all = loadIdeas();

  const now = new Date();
  const since =
    range === "ytd"
      ? `${now.getUTCFullYear()}-01-01`
      : RANGES.find((r) => r.key === range)?.days
        ? new Date(now.getTime() - RANGES.find((r) => r.key === range)!.days! * 86400000).toISOString()
        : null;
  const inRange = since ? all.filter((i) => i.date >= since) : all;

  const taken = inRange.filter((i) => i.status === "taken");
  const points = primaryPoints(taken);
  const s = summarize(points, be);
  const curve = equityCurve(points).map((p) => ({ n: p.n, cum: p.cum, label: fmtDate(p.date) }));
  const open = all.filter((i) => i.status === "taken" && i.primary && i.primary.r == null);
  const noOutcome = all.filter(
    (i) => (i.status === "skipped" || i.status === "missed" || i.status === "forward_test") && i.outcome == null && (!i.primary || i.primary.r == null),
  );
  const noReview = all.filter((i) => i.status === "taken" && i.primary?.r != null && (!i.review.trim() || i.followedPlan == null));
  const obs = observationStats(inRange.filter((i) => i.status === "forward_test"));

  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
  const week = summarize(primaryPoints(all.filter((i) => i.status === "taken" && i.date >= weekAgo)), be);

  const bySetup = groupSummaries(points, (p) => [p.idea.setup?.name ?? "No setup"], be)
    .map((g) => ({ ...g, setup: g.points[0].idea.setup }))
    .sort((a, b) => (b.summary.expectancy ?? -99) - (a.summary.expectancy ?? -99));

  const mistakes = mistakeSummary(taken);
  const mistakeRate = taken.length ? taken.filter((i) => i.mistakes.length).length / taken.length : null;

  const nonTaken = primaryPoints(inRange.filter((i) => i.status !== "taken"));
  const fwd = summarize(nonTaken.filter((p) => p.idea.status === "forward_test"), be);
  const skipped = summarize(nonTaken.filter((p) => p.idea.status === "skipped" || p.idea.status === "missed"), be);
  const backtest = summarize(nonTaken.filter((p) => p.idea.status === "backtest"), be);

  if (!all.length) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <EmptyState
          title="Welcome to your journal"
          description="Start by logging a trade — or a setup you skipped. Every idea you log makes the stats here more honest."
          action={
            <LinkButton href="/ideas/new" variant="primary">
              <Plus className="h-4 w-4" /> Log your first idea
            </LinkButton>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Taken trades only, in R. Skipped / missed / forward tests are tracked separately."
        actions={
          <div className="flex rounded-lg border border-line bg-panel-2 p-0.5">
            {RANGES.map((r) => (
              <Link
                key={r.key}
                href={r.key === "all" ? "/" : `/?range=${r.key}`}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium",
                  range === r.key ? "bg-panel-3 text-fg" : "text-muted hover:text-fg",
                )}
              >
                {r.label}
              </Link>
            ))}
          </div>
        }
      />

      {s.count > 0 && s.count < 20 && (
        <p className="mb-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-xs text-warn">
          Only {s.count} closed trade{s.count === 1 ? "" : "s"} — these numbers will swing a lot until you have 20+. Keep logging.
        </p>
      )}
      <div className="grid grid-cols-6 gap-3">
        <Kpi label="Closed trades" value={s.count} sub={<SampleBadge n={s.count} />} />
        <Kpi label="Win rate" value={<span title="Wins ÷ all closed trades (breakevens count as not-a-win)">{fmtPct(s.winRate)}</span>} sub={`${s.wins}W · ${s.losses}L · ${s.breakevens}BE`} />
        <Kpi label="Expectancy" value={<RValue r={s.expectancy} be={0} />} sub="avg R per trade" />
        <Kpi label="Total" value={<RValue r={s.count ? s.totalR : null} be={0} />} sub={`best ${fmtR(s.best)} · worst ${fmtR(s.worst)}`} />
        <Kpi label="Profit factor" value={s.profitFactor == null ? (s.wins ? "∞" : "—") : fmtNum(s.profitFactor)} sub={`avg win ${fmtR(s.avgWin)}`} />
        <Kpi label="Max drawdown" value={s.maxDrawdown ? <span className="text-loss">-{s.maxDrawdown.toFixed(2)}R</span> : <span className="text-faint">—</span>} sub={`longest losing streak ${s.longestLossStreak}`} />
      </div>

      <div className="mt-5 grid grid-cols-3 gap-5">
        <Card className="col-span-2">
          <CardHeader title="Equity curve (R)" description="Cumulative R of closed taken trades, in order." />
          <div className="px-2 pb-3">
            <EquityChart data={curve} />
          </div>
        </Card>
        <Card>
          <CardHeader title="R distribution" description="Where your results land." />
          <div className="px-2 pb-3">
            <RHistogram rs={points.map((p) => p.r)} />
          </div>
        </Card>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-5">
        <Card>
          <CardHeader title="Setups" description="Ranked by expectancy" action={<Link href="/analytics" className="text-xs text-accent">Analytics →</Link>} />
          <ul className="divide-y divide-line px-4 pb-2">
            {bySetup.slice(0, 6).map((g) => (
              <li key={g.key} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0 flex-1 overflow-hidden">
                  {g.setup ? (
                    <Link href={`/setups/${g.setup.id}`} className="block min-w-0 hover:text-accent">
                      <SetupBadge setup={g.setup} />
                    </Link>
                  ) : (
                    <span className="text-faint">No setup</span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-3 text-xs tabular">
                  <span className="text-faint">n={g.summary.count}</span>
                  <span className="text-muted">{fmtPct(g.summary.winRate)}</span>
                  <RValue r={g.summary.expectancy} be={0} />
                </span>
              </li>
            ))}
            {!bySetup.length && <li className="py-3 text-sm text-faint">No closed trades yet.</li>}
          </ul>
        </Card>

        <Card>
          <CardHeader
            title="Costliest mistakes"
            description={mistakeRate != null ? `${fmtPct(mistakeRate)} of taken trades had a mistake · cost = R lost vs the linked alternative` : "R lost per mistake type"}
            action={<Link href="/analytics?group=mistake" className="text-xs text-accent">Analyze →</Link>}
          />
          <ul className="divide-y divide-line px-4 pb-2">
            {mistakes.slice(0, 6).map((g) => (
              <li key={g.name} className="flex items-center justify-between py-2 text-sm">
                <span className="min-w-0 truncate">{g.name}</span>
                <span className="flex shrink-0 items-center gap-3 text-xs tabular">
                  <span className="text-faint">×{g.count}</span>
                  {g.costKnown ? <span className="font-semibold text-loss">−{g.cost.toFixed(2)}R</span> : <span className="text-faint">cost ?</span>}
                </span>
              </li>
            ))}
            {!mistakes.length && <li className="py-3 text-sm text-faint">No mistakes recorded — log them honestly in the trade editor.</li>}
          </ul>
        </Card>

        <Card>
          <CardHeader title="At a glance" />
          <dl className="space-y-2.5 px-4 pb-4 text-sm">
            <Row label="Last 7 days" value={<><RValue r={week.count ? week.totalR : null} be={0} /> <span className="text-faint">· {week.count} trades</span></>} />
            <Row label="Open trades" value={<Link href="/ideas?open=1" className="hover:text-accent">{open.length}</Link>} />
            <Row label="Followed plan" value={fmtPct(s.followedPlanPct)} />
            <Row
              label="Forward tests"
              value={
                <>
                  {fwd.count > 0 && <><RValue r={fwd.expectancy} be={0} /> <span className="text-faint">avg · n={fwd.count}</span></>}
                  {obs.count > 0 && <span className="text-muted">{fwd.count > 0 ? " · " : ""}{fmtPct(obs.hitRate)} hit <span className="text-faint">({obs.hits}/{obs.count})</span></span>}
                  {!fwd.count && !obs.count && <span className="text-faint">—</span>}
                </>
              }
            />
            {backtest.count > 0 && (
              <Row
                label="Backtests"
                value={<><RValue r={backtest.expectancy} be={0} /> <span className="text-faint">avg · {fmtPct(backtest.winRate)} · n={backtest.count}</span></>}
              />
            )}
            <Row
              label="Skipped / missed"
              value={<Link href="/analytics?tab=skips" className="hover:text-accent"><RValue r={skipped.count ? skipped.totalR : null} be={0} /> <span className="text-faint">if taken · n={skipped.count}</span></Link>}
            />
          </dl>
        </Card>
      </div>

      {(open.length > 0 || noOutcome.length > 0 || noReview.length > 0) && (
        <Card className="mt-5">
          <CardHeader title="Needs attention" description="Close the loop on these during your review." />
          <ul className="divide-y divide-line px-4 pb-2 text-sm">
            {[
              ...open.map((i) => ({ i, why: "Still open — add the exit" })),
              ...noOutcome.map((i) => ({ i, why: "No outcome yet — what happened?" })),
              ...noReview.map((i) => ({ i, why: !i.review.trim() ? "No review written" : "Followed plan? not answered" })),
            ]
              .slice(0, 8)
              .map(({ i, why }) => (
                <li key={`${i.id}-${why}`} className="flex items-center justify-between gap-3 py-2">
                  <Link href={`/ideas/${i.id}/edit`} className="min-w-0 truncate hover:text-accent">
                    <span className="font-medium">{i.symbol}</span>{" "}
                    <span className="text-faint">
                      {i.setup?.name ?? "No setup"} · {fmtDate(i.openedAt)}
                    </span>
                  </Link>
                  <span className="shrink-0 text-xs text-warn">{why}</span>
                </li>
              ))}
          </ul>
        </Card>
      )}

      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Recent ideas</h2>
          <Link href="/ideas" className="text-xs text-accent">
            All →
          </Link>
        </div>
        <IdeaTable ideas={all.slice(0, 8)} be={be} />
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}
