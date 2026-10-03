import { Plus } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { AnalyticsControls } from "@/components/analytics-controls";
import { BalanceForm } from "@/components/balance-form";
import { BalanceResults } from "@/components/balance-results";
import { parseBalanceParams, simOptions } from "@/lib/balance";
import { METRICS, type MetricKey } from "@/lib/metrics";
import { RValue, SampleBadge, StatusBadge } from "@/components/bits";
import { BreakdownList } from "@/components/breakdown-list";
import { BarMetricChart, MultiEquityChart } from "@/components/charts";
import { ComparisonTable } from "@/components/comparison-table";
import { FilterBar } from "@/components/filter-bar";
import { Card, CardHeader, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { fmtDate, fmtDrawdown, fmtPct, fmtProfitFactor, fmtR } from "@/lib/format";
import {
  applyFilters,
  DIMENSIONS,
  dimensionKeys,
  NO_TAG,
  isDimension,
  parseFilters,
  primaryPoints,
  scenarioComparisons,
} from "@/lib/analytics";
import { listSetups, listTags, loadIdeas, tagGroups } from "@/lib/queries";
import { getSettings } from "@/lib/settings";
import { SKIP_REASON_GROUP } from "@/db/schema";
import { STATUS_BUCKETS } from "@/lib/status";
import { equityCurve, groupSummaries, simulateBalance, skipAudit, type Summary } from "@/lib/stats";

export const metadata = { title: "Analytics" };

type Sp = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  const tab = one(sp.tab) ?? "breakdown";
  const groupRaw = one(sp.group) ?? "setup";
  const metricRaw = one(sp.metric);
  const metric: MetricKey = METRICS.some((m) => m.key === metricRaw) ? (metricRaw as MetricKey) : "expectancy";
  const { beThresholdR: be, defaultRiskPct } = getSettings();

  const all = loadIdeas();
  const filters = parseFilters(sp);
  // Breakdown defaults to taken trades only; the other tabs pick their own statuses.
  const breakdownFilters = { ...filters, status: filters.status ?? ["taken" as const] };
  const setups = listSetups();
  const tags = listTags();
  const symbols = [...new Set(all.map((i) => i.symbol))].sort();
  const groupsList = tagGroups();
  const dims = [...DIMENSIONS, ...groupsList.map((g) => ({ key: `group:${g}`, label: `Tag group: ${g}` }))];
  const group = isDimension(groupRaw, groupsList) ? groupRaw : "setup";
  const setupColor = new Map(setups.map((s) => [s.name, s.color]));
  const tagColor = new Map(tags.map((t) => [t.name, t.color]));

  if (!all.length) {
    return (
      <>
        <PageHeader title="Analytics" description="Slice your results any way you want. Everything is in R." />
        <EmptyState
          title="Nothing to analyse yet"
          description="Log a few ideas first. Analytics slices them by setup, tag, mistake, session and more."
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
        title="Analytics"
        description={tab === "balance" ? "Hypothetical balance in $, simulated from your R results." : "Slice your results any way you want. Everything is in R."}
      />
      <Suspense>
        <AnalyticsControls dimensions={dims} group={group} metric={metric} tab={tab} />
        <FilterBar setups={setups} tags={tags} symbols={symbols} showStatus={tab !== "skips"} defaultStatus={tab !== "skips" ? "taken" : undefined} />
      </Suspense>

      {tab === "breakdown" && (() => {
        const points = primaryPoints(applyFilters(all, breakdownFilters));
        const groups = groupSummaries(points, dimensionKeys(group), be);
        const value = (s: Summary) => (metric === "count" ? s.count : s[metric]);
        // Profit factor with no losses is ∞ (stored as null) — rank it first, not last.
        const sortValue = (s: Summary) => (metric === "profitFactor" && s.profitFactor == null && s.wins > 0 ? Infinity : (value(s) ?? -Infinity));
        groups.sort((a, b) => sortValue(b.summary) - sortValue(a.summary) || b.summary.count - a.summary.count);
        const colorOf = (k: string) => (group === "setup" ? setupColor.get(k) : group === "tag" || group.startsWith("group:") ? tagColor.get(k) : undefined);
        const topForCurves = [...groups].sort((a, b) => b.summary.count - a.summary.count).slice(0, 6);
        return (
          <div className="space-y-5">
            <Card>
              <CardHeader
                title={`${METRICS.find((m) => m.key === metric)?.label} by ${dims.find((d) => d.key === group)?.label.toLowerCase()}`}
                description={`${points.length} closed ideas · groups with few trades are noisy — check n`}
              />
              <div className="px-2 pb-3">
                <BarMetricChart
                  data={groups.map((g) => ({ key: g.key, value: value(g.summary), color: metric === "expectancy" || metric === "totalR" ? undefined : colorOf(g.key) }))}
                  format={metric === "winRate" ? "pct" : metric === "count" ? "count" : "r"}
                />
              </div>
            </Card>

            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-panel">
                    <tr className="text-left text-[11px] uppercase tracking-wider text-faint">
                      <th className="px-3 py-2.5 font-medium">{dims.find((d) => d.key === group)?.label}</th>
                      <th className="px-3 py-2.5 text-right font-medium">Trades</th>
                      <th className="px-3 py-2.5 text-right font-medium">Win rate</th>
                      <th className="px-3 py-2.5 text-right font-medium">Avg win</th>
                      <th className="px-3 py-2.5 text-right font-medium">Avg loss</th>
                      <th className="px-3 py-2.5 text-right font-medium">Expectancy</th>
                      <th className="px-3 py-2.5 text-right font-medium">Total</th>
                      <th className="px-3 py-2.5 text-right font-medium">PF</th>
                      <th className="px-3 py-2.5 text-right font-medium">Max DD</th>
                      <th className="px-3 py-2.5 text-right font-medium">Plan kept</th>
                    </tr>
                  </thead>
                  <tbody className="tabular">
                    {groups.map((g) => (
                      <tr key={g.key} className="border-t border-line">
                        <td className="px-3 py-2.5">
                          <span className="flex items-center gap-2 font-medium">
                            {colorOf(g.key) && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colorOf(g.key) }} />}
                            {g.key}
                          </span>
                          <SampleBadge n={g.summary.count} />
                        </td>
                        <td className="px-3 py-2.5 text-right">{g.summary.count}</td>
                        <td className="px-3 py-2.5 text-right">{fmtPct(g.summary.winRate)}</td>
                        <td className="px-3 py-2.5 text-right text-win">{fmtR(g.summary.avgWin)}</td>
                        <td className="px-3 py-2.5 text-right text-loss">{fmtR(g.summary.avgLoss)}</td>
                        <td className="px-3 py-2.5 text-right">
                          <RValue r={g.summary.expectancy} be={0} />
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <RValue r={g.summary.totalR} be={0} />
                        </td>
                        <td className="px-3 py-2.5 text-right">{fmtProfitFactor(g.summary)}</td>
                        <td className="px-3 py-2.5 text-right text-loss">{fmtDrawdown(g.summary)}</td>
                        <td className="px-3 py-2.5 text-right text-muted">{fmtPct(g.summary.followedPlanPct)}</td>
                      </tr>
                    ))}
                    {!groups.length && (
                      <tr>
                        <td colSpan={10} className="px-3 py-8 text-center text-faint">
                          No closed ideas match these filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card>
              <CardHeader title="Equity curves" description="Top groups by trade count, cumulative R trade by trade" />
              <div className="px-2 pb-3">
                <MultiEquityChart
                  series={topForCurves.map((g) => ({ key: g.key, color: colorOf(g.key), points: equityCurve(g.points) }))}
                />
              </div>
            </Card>
          </div>
        );
      })()}

      {tab === "balance" && (() => {
        const scoped = applyFilters(all, breakdownFilters);
        const pts = primaryPoints(scoped);
        const { inputs, errors } = parseBalanceParams(sp, defaultRiskPct);
        const bad = Object.keys(errors).length > 0;
        const sim = bad ? null : simulateBalance(pts.map((p) => ({ ...p, riskPct: p.idea.riskPct })), simOptions(inputs));
        const raw = (k: string) => one(sp[k]);
        const d = parseBalanceParams({}, defaultRiskPct).inputs;
        const defaults = { start: String(d.start), risk: String(d.riskPct), mode: d.mode, trade: false, fee: String(d.fee) };
        const values = {
          start: raw("start") ?? String(inputs.start),
          risk: raw("risk") ?? String(inputs.riskPct),
          mode: raw("mode") ?? inputs.mode,
          trade: inputs.useTradeRisk,
          fee: raw("fee") ?? String(inputs.fee),
        };
        return (
          <>
            <BalanceForm key={JSON.stringify(values)} values={values} errors={errors} defaults={defaults} />
            {bad || !sim ? (
              <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/[0.07] px-3 py-2 text-sm text-loss">
                Fix the highlighted inputs to run the simulation.
              </p>
            ) : (
              <BalanceResults
                sim={sim}
                meta={Object.fromEntries(pts.map((p) => [p.id, { setup: p.idea.setup?.name ?? "No setup", status: p.idea.status }]))}
                statuses={breakdownFilters.status}
                defaultRiskPct={inputs.riskPct}
                useTradeRisk={inputs.useTradeRisk}
              />
            )}
          </>
        );
      })()}

      {tab === "alternatives" && (() => {
        const scoped = applyFilters(all, breakdownFilters);
        const rows = scenarioComparisons(scoped, be);
        return (
          <Card>
            <CardHeader
              title="Actual vs alternatives"
              description="What if you'd traded it that way instead? Compared across every idea where both the primary and the alternative are closed. “Not filled” counts as 0R. R assumes the same risk per trade."
            />
            <ComparisonTable rows={rows} />
          </Card>
        );
      })()}

      {tab === "skips" && (() => {
        const skippedIdeas = applyFilters(all, { ...filters, status: [...STATUS_BUCKETS.skips] });
        const pts = primaryPoints(skippedIdeas);
        const sk = skipAudit(pts.filter((p) => p.idea.status === "skipped"), be);
        const ms = skipAudit(pts.filter((p) => p.idea.status === "missed"), be);
        const byReason = groupSummaries(pts.filter((p) => p.idea.status === "skipped"), dimensionKeys(`group:${SKIP_REASON_GROUP}`), be).sort(
          (a, b) => b.summary.count - a.summary.count,
        );
        const bySetup = groupSummaries(pts, dimensionKeys("setup"), be).sort((a, b) => b.summary.count - a.summary.count);
        const noOutcome = skippedIdeas.filter((i) => i.primary?.r == null);
        const rOrDash = (n: number, v: number) => (n ? <RValue r={v} be={0} /> : <span className="text-faint">—</span>);
        return (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              {[
                { title: "Skipped on purpose", sub: "Your filter: would taking them have helped?", a: sk },
                { title: "Missed", sub: "Execution: valid setups you didn't catch", a: ms },
              ].map(({ title, sub, a }) => (
                <Card key={title} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{title}</p>
                      <p className="text-xs text-faint">{sub}</p>
                    </div>
                    <SampleBadge n={a.count} />
                  </div>
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <dt className="text-[11px] text-faint">Left on the table</dt>
                      <dd className="font-semibold tabular text-win">{a.count ? fmtR(a.leftOnTable) : "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-faint">Losses avoided</dt>
                      <dd className="font-semibold tabular text-loss">{a.count ? `${a.lossesAvoided.toFixed(2)}R` : "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-faint">Net if taken</dt>
                      <dd className="font-semibold tabular">{rOrDash(a.count, a.net)}</dd>
                    </div>
                  </dl>
                  {a.count >= 10 && (
                    <p className="mt-2 text-xs text-muted">
                      {a.summary.expectancy != null && a.summary.expectancy > 0
                        ? `On average each one would have made ${fmtR(a.summary.expectancy)} — your rule may be too strict.`
                        : "On average they'd have lost — this filter is protecting you."}
                    </p>
                  )}
                </Card>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-5">
              <Card>
                <CardHeader title="Skipped — by reason" description={`Tag skips under “${SKIP_REASON_GROUP}”. Positive R = that reason is costing you.`} />
                <BreakdownList
                  rows={byReason.map((g) => ({ ...g, label: g.key === NO_TAG ? <span className="text-faint">No reason tag</span> : g.key }))}
                  value="totalR"
                  empty={
                    groupsList.includes(SKIP_REASON_GROUP)
                      ? "No skipped ideas with an outcome yet."
                      : `No “${SKIP_REASON_GROUP}” tag group found. Add tags in that group in Settings to compare reasons.`
                  }
                />
              </Card>
              <Card>
                <CardHeader title="Skipped & missed — by setup" />
                <BreakdownList rows={bySetup} value="totalR" empty="Log skipped setups with their hypothetical exit to see this." />
              </Card>
            </div>
            <Card>
              <CardHeader title="Skip log" description="Your reasons, side by side with what happened." />
              <ul className="divide-y divide-line px-4 pb-2">
                {skippedIdeas.map((i) => (
                  <li key={i.id} className="flex items-start justify-between gap-3 py-2.5">
                    <Link href={`/ideas/${i.id}`} className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {i.symbol} <StatusBadge status={i.status} />
                        <span className="text-xs font-normal text-faint">
                          {i.setup?.name ?? "No setup"} · {fmtDate(i.openedAt)}
                        </span>
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-sm break-words text-muted">{i.skipReason || "—"}</span>
                    </Link>
                    <span className="shrink-0 text-sm">
                      {i.primary?.r == null ? <span className="text-xs text-faint">no outcome</span> : <RValue r={i.primary.r} be={be} />}
                    </span>
                  </li>
                ))}
                {!skippedIdeas.length && <li className="py-3 text-sm text-faint">Nothing skipped or missed yet.</li>}
              </ul>
              {noOutcome.length > 0 && (
                <p className="px-4 pb-3 text-xs text-warn">
                  {noOutcome.length} skipped / missed idea(s) have no outcome yet and are left out of the numbers above — add the exit that would have happened.
                </p>
              )}
            </Card>
          </div>
        );
      })()}
    </>
  );
}
