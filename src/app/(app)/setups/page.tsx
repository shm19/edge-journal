import { Plus } from "lucide-react";
import Link from "next/link";
import { RValue, SampleBadge } from "@/components/bits";
import { Badge, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { fmtPct } from "@/lib/format";
import { listSetups, loadIdeas, observationStats, primaryPoints } from "@/lib/queries";
import { getSettings } from "@/lib/settings";
import { summarize } from "@/lib/stats";

export const metadata = { title: "Setups" };

const STATUS_TONE: Record<string, string> = { live: "#34d399", testing: "#22d3ee", retired: "#71717a" };

export default async function SetupsPage() {
  const { beThresholdR: be } = getSettings();
  const setups = listSetups();
  const ideas = loadIdeas();
  const order = { live: 0, testing: 1, retired: 2 } as const;

  return (
    <>
      <PageHeader
        title="Setups"
        description="Your playbook. Stats use closed taken trades; forward tests are shown separately."
        actions={
          <LinkButton href="/setups/new" variant="primary">
            <Plus className="h-4 w-4" /> New setup
          </LinkButton>
        }
      />
      {setups.length === 0 ? (
        <EmptyState title="No setups yet" description="Describe each setup's rules so you can measure it." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[...setups]
            .sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name))
            .map((s) => {
              const mine = ideas.filter((i) => i.setupId === s.id);
              const taken = summarize(primaryPoints(mine.filter((i) => i.status === "taken")), be);
              const fwd = summarize(primaryPoints(mine.filter((i) => i.status === "forward_test")), be);
              const obs = observationStats(mine.filter((i) => i.status === "forward_test"));
              const bt = summarize(primaryPoints(mine.filter((i) => i.status === "backtest")), be);
              return (
                <Link
                  key={s.id}
                  href={`/setups/${s.id}`}
                  className="group flex flex-col rounded-xl border border-line bg-panel p-4 transition-colors hover:border-line-strong"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                      <span className="truncate font-medium group-hover:text-accent">{s.name}</span>
                    </div>
                    <Badge color={STATUS_TONE[s.status]}>{s.status}</Badge>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-sm text-muted">{s.description || "No description"}</p>
                  <div className="mt-auto grid grid-cols-3 gap-2 pt-4 text-sm">
                    <div>
                      <p className="text-[11px] text-faint">Win rate</p>
                      <p className="font-semibold tabular">{fmtPct(taken.winRate)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-faint">Expectancy</p>
                      <RValue r={taken.expectancy} be={0} />
                    </div>
                    <div>
                      <p className="text-[11px] text-faint">Total</p>
                      <RValue r={taken.count ? taken.totalR : null} be={0} />
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px]">
                    <SampleBadge n={taken.count} />
                    <span className="flex gap-2">
                      {bt.count > 0 && (
                        <span className="text-violet-300">
                          backtest {fmtPct(bt.winRate)} · n={bt.count}
                        </span>
                      )}
                      {fwd.count > 0 && (
                        <span className="text-cyan-300">
                          fwd {fmtPct(fwd.winRate)} · n={fwd.count}
                        </span>
                      )}
                      {obs.count > 0 && (
                        <span className="text-cyan-300">
                          hit {fmtPct(obs.hitRate)} · {obs.hits}/{obs.count}
                        </span>
                      )}
                    </span>
                  </div>
                </Link>
              );
            })}
        </div>
      )}
    </>
  );
}
