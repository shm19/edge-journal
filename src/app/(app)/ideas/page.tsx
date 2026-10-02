import { Plus } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { RValue, SampleBadge } from "@/components/bits";
import { FilterBar } from "@/components/filter-bar";
import { IdeaTable } from "@/components/idea-table";
import { EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { fmtPct } from "@/lib/format";
import { applyFilters, listSetups, listTags, loadIdeas, parseFilters, primaryPoints } from "@/lib/queries";
import { getSettings } from "@/lib/settings";
import { summarize } from "@/lib/stats";

export const metadata = { title: "Journal" };

export default async function IdeasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const settings = getSettings();
  const all = loadIdeas();
  const filters = parseFilters(sp);
  const list = applyFilters(all, filters);
  // Real results only: the summary bar never mixes in skipped / missed / forward-test / backtest R.
  const summary = summarize(primaryPoints(list.filter((i) => i.status === "taken")), settings.beThresholdR);
  const openCount = list.filter((i) => i.status === "taken" && i.primary && i.primary.r == null).length;
  const symbols = [...new Set([...settings.symbols, ...all.map((i) => i.symbol)])].sort();

  return (
    <>
      <PageHeader
        title="Journal"
        description={`${list.length} of ${all.length} ideas · times in UTC`}
        actions={
          <LinkButton href="/ideas/new" variant="primary">
            <Plus className="h-4 w-4" /> New idea
          </LinkButton>
        }
      />
      <Suspense>
        <FilterBar setups={listSetups()} tags={listTags()} symbols={symbols} />
      </Suspense>

      {filters.open && (
        <p className="mb-3 text-sm text-muted">
          Showing ideas that are still open (no exit yet).{" "}
          <Link href="/ideas" className="text-accent">
            Show all
          </Link>
        </p>
      )}

      {list.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border border-line bg-panel px-4 py-2.5 text-sm">
          <span className="text-xs font-medium uppercase tracking-wider text-faint">Taken trades</span>
          <span className="text-muted">
            Closed <span className="font-semibold text-fg tabular">{summary.count}</span>
            {openCount > 0 && <span className="text-faint"> · {openCount} open</span>}
          </span>
          <span className="text-muted">
            <span title="Wins ÷ all closed trades (breakevens count as not-a-win)">Win rate</span>{" "}
            <span className="font-semibold text-fg tabular">{fmtPct(summary.winRate)}</span>
          </span>
          <span className="text-muted">
            Expectancy <RValue r={summary.expectancy} be={0} />
          </span>
          <span className="text-muted">
            Total <RValue r={summary.count ? summary.totalR : null} be={0} />
          </span>
          <span className="ml-auto">
            <SampleBadge n={summary.count} />
          </span>
        </div>
      )}

      {list.length ? (
        <IdeaTable ideas={list} be={settings.beThresholdR} />
      ) : all.length ? (
        <EmptyState title="Nothing matches these filters" description="Try clearing a filter." />
      ) : (
        <EmptyState
          title="Your journal is empty"
          description="Log every setup you see — taken, skipped, missed or forward-tested. That's how you find your edge."
          action={
            <LinkButton href="/ideas/new" variant="primary">
              <Plus className="h-4 w-4" /> Log your first idea
            </LinkButton>
          }
        />
      )}
    </>
  );
}
