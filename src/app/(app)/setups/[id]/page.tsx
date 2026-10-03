import { BarChart3, Calculator, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Kpi, Markdown, RValue, SampleBadge } from "@/components/bits";
import { BreakdownList } from "@/components/breakdown-list";
import { EquityChart } from "@/components/charts";
import { ComparisonTable } from "@/components/comparison-table";
import { Gallery } from "@/components/gallery";
import { IdeaTable } from "@/components/idea-table";
import { Badge, Card, CardHeader, LinkButton } from "@/components/ui";
import { fmtDate, fmtPct, fmtProfitFactor } from "@/lib/format";
import { dimensionKeys, observationStats, primaryPoints, scenarioComparisons } from "@/lib/analytics";
import { getSetup, loadIdeas } from "@/lib/queries";
import { getSettings } from "@/lib/settings";
import { inBuckets } from "@/lib/status";
import { equityCurve, groupSummaries, summarize } from "@/lib/stats";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: getSetup(Number(id))?.name ?? "Setup" };
}

export default async function SetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const setup = getSetup(Number(id));
  if (!setup) notFound();
  const { beThresholdR: be } = getSettings();
  const mine = loadIdeas().filter((i) => i.setupId === setup.id);
  const taken = inBuckets(mine, "taken");
  const points = primaryPoints(taken);
  const s = summarize(points, be);
  const fwd = summarize(primaryPoints(inBuckets(mine, "forward")), be);
  const skipped = summarize(primaryPoints(inBuckets(mine, "skips")), be);
  const backtest = summarize(primaryPoints(inBuckets(mine, "backtest")), be);
  const obs = observationStats(inBuckets(mine, "forward"));
  // Until there are live trades, chart the backtest (or forward test) so the setup page isn't empty.
  const curveSource = points.length
    ? { label: "taken trades", pts: points }
    : (() => {
        const bt = primaryPoints(inBuckets(mine, "backtest"));
        if (bt.length) return { label: "backtest trades", pts: bt };
        return { label: "forward tests", pts: primaryPoints(inBuckets(mine, "forward")) };
      })();
  const curve = equityCurve(curveSource.pts).map((p) => ({ n: p.n, cum: p.cum, label: fmtDate(p.date) }));

  const breakdown = (dim: string) =>
    groupSummaries(points, dimensionKeys(dim), be).sort((a, b) => b.summary.count - a.summary.count);

  const images = mine.flatMap((i) =>
    i.attachments.map((a) => ({
      src: `/api/uploads/${a.filePath}`,
      caption: `${i.symbol} · ${fmtDate(i.openedAt)}${i.primary?.r != null ? ` · ${i.primary.r.toFixed(2)}R` : ""}`,
      label: a.kind,
      href: `/ideas/${i.id}`,
    })),
  );

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/setups" className="text-sm text-muted hover:text-fg">
            ← Setups
          </Link>
          <div className="mt-2 flex items-center gap-2.5">
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: setup.color }} />
            <h1 className="text-xl font-semibold tracking-tight">{setup.name}</h1>
            <Badge>{setup.status}</Badge>
            {setup.defaultTimeframe && <Badge>{setup.defaultTimeframe}</Badge>}
          </div>
          {setup.description && <p className="mt-1 max-w-2xl text-sm text-muted">{setup.description}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <LinkButton href={`/ideas/new?setup=${setup.id}`} variant="primary" size="sm">
            <Plus className="h-3.5 w-3.5" /> Log idea
          </LinkButton>
          <LinkButton href={`/ideas/new?setup=${setup.id}&status=${setup.status === "testing" ? "forward_test" : "backtest"}`} size="sm">
            <Plus className="h-3.5 w-3.5" /> {setup.status === "testing" ? "Forward test" : "Backtest"}
          </LinkButton>
          <LinkButton href={`/analytics?setup=${setup.id}&group=tag`} size="sm">
            <BarChart3 className="h-3.5 w-3.5" /> Analyze
          </LinkButton>
          <LinkButton href={`/analytics?tab=balance&setup=${setup.id}`} size="sm">
            <Calculator className="h-3.5 w-3.5" /> Simulate
          </LinkButton>
          <LinkButton href={`/setups/${setup.id}/edit`} size="sm">
            <Pencil className="h-3.5 w-3.5" /> Edit
          </LinkButton>
        </div>
      </div>

      <div className="grid grid-cols-6 gap-3">
        <Kpi label="Taken (closed)" value={s.count} sub={<SampleBadge n={s.count} />} />
        <Kpi label="Win rate" value={fmtPct(s.winRate)} sub={`${s.wins}W · ${s.losses}L · ${s.breakevens}BE`} />
        <Kpi label="Expectancy" value={<RValue r={s.expectancy} be={0} />} />
        <Kpi label="Total" value={<RValue r={s.totalR} be={0} />} sub={`PF ${fmtProfitFactor(s)}`} />
        <Kpi
          label="Forward test"
          value={obs.count && !fwd.count ? `${fmtPct(obs.hitRate)} hit` : <RValue r={fwd.expectancy} be={0} />}
          sub={
            !fwd.count && !obs.count
              ? undefined
              : obs.count && !fwd.count
                ? `${obs.hits} of ${obs.count} observations`
                : `avg · ${fmtPct(fwd.winRate)} · n=${fwd.count}${obs.count ? ` · ${obs.hits}/${obs.count} hit` : ""}`
          }
        />
        <Kpi
          label={backtest.count ? "Backtest" : "Skipped / missed"}
          value={backtest.count ? <RValue r={backtest.expectancy} be={0} /> : <RValue r={skipped.totalR} be={0} />}
          sub={backtest.count ? `avg · ${fmtPct(backtest.winRate)} · n=${backtest.count}` : `if taken · n=${skipped.count}`}
        />
      </div>

      <div className="mt-5 grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-5">
        <Card>
          <CardHeader title="Equity curve (R)" description={`Cumulative R of ${curveSource.label}`} />
          <div className="px-2 pb-3">
            <EquityChart data={curve} height={220} />
          </div>
        </Card>
        <Card className="p-4">
          <p className="mb-1 text-xs font-medium text-faint">Rules</p>
          <Markdown>{setup.rules}</Markdown>
          {setup.checklist.length > 0 && (
            <>
              <p className="mt-4 mb-1 text-xs font-medium text-faint">Checklist</p>
              <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted">
                {setup.checklist.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-5 xl:grid-cols-4">
        {[
          { dim: "timeframe", title: "By entry timeframe" },
          { dim: "bias", title: "By HTF bias" },
          { dim: "regime", title: "Range vs trend" },
          { dim: "mistake", title: "By mistake type" },
        ].map(({ dim, title }) => (
          <Card key={dim}>
            <CardHeader title={title} />
            <BreakdownList rows={breakdown(dim)} value="expectancy" empty="No closed trades yet." />
          </Card>
        ))}
      </div>

      <Card className="mt-5">
        <CardHeader title="Alternatives for this setup" description="Would a different entry / stop / exit have done better?" />
        <ComparisonTable rows={scenarioComparisons(taken, be)} />
      </Card>

      {images.length > 0 && (
        <Card className="mt-5">
          <CardHeader title="Chartbook" description="Every screenshot logged with this setup" />
          <div className="px-4 pb-4">
            <Gallery images={images} columns="grid-cols-4" />
          </div>
        </Card>
      )}

      <div className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">Ideas ({mine.length})</h2>
        {mine.length ? <IdeaTable ideas={mine} be={be} /> : <p className="text-sm text-faint">None yet.</p>}
      </div>
    </>
  );
}
