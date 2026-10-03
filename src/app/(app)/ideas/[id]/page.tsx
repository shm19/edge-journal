import { ArrowLeft, Check, ChevronLeft, ChevronRight, Circle } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DirectionBadge, Markdown, RValue, SetupBadge, StatusBadge, TagChip } from "@/components/bits";
import { Gallery } from "@/components/gallery";
import { IdeaActions } from "@/components/idea-actions";
import { Badge, Card, CardHeader } from "@/components/ui";
import { cn } from "@/lib/cn";
import { BIAS_LABEL, EXIT_LABEL, fmtCost, fmtDateTime, fmtPrice, fmtR, REGIME_LABEL } from "@/lib/format";
import { getIdea, ideaNeighbours } from "@/lib/queries";
import { getSettings } from "@/lib/settings";
import { isHypothetical } from "@/lib/status";
import { sessionOf, tradeMistakeCost } from "@/lib/stats";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const idea = getIdea(Number(id));
  return { title: idea ? `${idea.symbol} ${idea.direction}` : "Idea" };
}

export default async function IdeaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const idea = getIdea(Number(id));
  if (!idea) notFound();
  const { beThresholdR, minRR } = getSettings();

  // Prev / next in journal order (newest first).
  const { newer, older } = ideaNeighbours(idea);
  const mistakeTotal = tradeMistakeCost(idea.mistakes);
  const measured = idea.mistakes.filter((m) => m.cost != null).length;
  // A mistake measured against an alternative that an earlier mistake already counted (see tradeMistakeCost).
  const seenAlt = new Set<number>();
  const sharedIds = new Set(
    idea.mistakes.filter((m) => {
      if (m.costR != null || m.scenarioId == null || m.cost == null) return false;
      return seenAlt.size === seenAlt.add(m.scenarioId).size;
    }).map((m) => m.id),
  );

  const primary = idea.primary;
  // Skipped / missed / forward-test results are what would have happened, not realised profit.
  const hypothetical = isHypothetical(idea.status);
  const checklist = idea.setup?.checklist ?? [];
  const checked = checklist.filter((c) => idea.checklistState[c]).length;

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-2">
        <Link href="/ideas" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
          <ArrowLeft className="h-4 w-4" /> Journal
        </Link>
        <div className="flex items-center gap-1">
          <NavArrow href={newer ? `/ideas/${newer}` : null} label="Newer">
            <ChevronLeft className="h-4 w-4" />
          </NavArrow>
          <NavArrow href={older ? `/ideas/${older}` : null} label="Older">
            <ChevronRight className="h-4 w-4" />
          </NavArrow>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{idea.symbol}</h1>
            <DirectionBadge direction={idea.direction} />
            <StatusBadge status={idea.status} />
            {primary?.exitReason === "not_filled" ? (
              <span className="text-lg text-faint">not filled</span>
            ) : primary ? (
              <>
                {hypothetical && primary.r != null && <span className="text-sm text-muted">if taken</span>}
                <RValue r={primary.r} be={beThresholdR} className="text-2xl" />
              </>
            ) : null}
            {idea.outcome && (
              <span className={cn("text-lg font-semibold", idea.outcome === "hit" ? "text-win" : "text-loss")}>
                {idea.outcome === "hit" ? "Hit" : "Miss"}
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
            <SetupBadge setup={idea.setup} />
            <span>{fmtDateTime(idea.openedAt)}</span>
            {idea.closedAt && <span>→ {fmtDateTime(idea.closedAt)}</span>}
            {idea.status === "taken" && idea.closedAt === idea.openedAt && primary?.exitPrice != null && (
              <span className="text-xs text-faint">Closed time = opened time — set the real close time</span>
            )}
            <span>{sessionOf(idea.openedAt)}</span>
            {idea.entryTimeframe && <Badge>{idea.entryTimeframe}</Badge>}
            {idea.htfBias && <Badge>{BIAS_LABEL[idea.htfBias]}</Badge>}
            {idea.regime && <Badge>{REGIME_LABEL[idea.regime]}</Badge>}
          </div>
          {idea.tags.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {idea.tags.map((t) => (
                <TagChip key={t.id} tag={t} />
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <IdeaActions id={idea.id} />
        </div>
      </div>

      {/* Full width: the alternatives comparison is the headline feature and needs all its columns. */}
      {idea.scenarios.length > 0 && (
      <Card className="mb-5">
        <CardHeader title="Scenarios" description="R of each scenario, and how alternatives compare to the primary." />
        <div className="overflow-x-auto px-2 pb-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-faint">
                <th className="px-2 py-2 font-medium">Scenario</th>
                <th className="px-2 py-2 text-right font-medium">Entry</th>
                <th className="px-2 py-2 text-right font-medium">Stop</th>
                <th className="px-2 py-2 text-right font-medium">Target</th>
                <th className="px-2 py-2 text-right font-medium">Exit</th>
                <th className="px-2 py-2 text-right font-medium">R:R</th>
                <th className="px-2 py-2 text-right font-medium">R</th>
                <th className="px-2 py-2 text-right font-medium whitespace-nowrap">vs primary</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {[...idea.scenarios]
                .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
                .map((s) => {
                  const delta = !s.isPrimary && s.r != null && primary?.r != null ? s.r - primary.r : null;
                  return (
                    <tr key={s.id} className={cn("border-t border-line align-top", s.isPrimary && "bg-accent/[0.04]")}>
                      <td className="px-2 py-2">
                        <p className="font-medium">
                          {s.isPrimary ? (idea.status === "taken" || idea.status === "backtest" ? "Actual" : "Plan") : (s.typeName ?? "Alternative")}
                        </p>
                        {s.exitReason && <p className="text-xs text-faint">{EXIT_LABEL[s.exitReason]}</p>}
                        {s.notes && <p className="mt-0.5 max-w-xs text-xs break-words text-muted">{s.notes}</p>}
                      </td>
                      <td className="px-2 py-2 text-right">{fmtPrice(s.entry)}</td>
                      <td className="px-2 py-2 text-right">{fmtPrice(s.stop)}</td>
                      <td className="px-2 py-2 text-right">{fmtPrice(s.target)}</td>
                      <td className="px-2 py-2 text-right">{fmtPrice(s.exitPrice)}</td>
                      <td className={cn("px-2 py-2 text-right", s.rr != null && s.rr < minRR && "text-warn")}>{s.rr == null ? "—" : s.rr.toFixed(2)}</td>
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        {s.exitReason === "not_filled" ? (
                          <span className="text-faint">not filled</span>
                        ) : s.r == null ? (
                          <span className="text-faint">open</span>
                        ) : (
                          <RValue r={s.r} be={beThresholdR} />
                        )}
                      </td>
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        {delta == null ? (
                          <span className="text-faint">—</span>
                        ) : (
                          <span className={delta > 0 ? "text-win" : delta < 0 ? "text-loss" : "text-be"}>{fmtR(delta)}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </Card>
      )}

      <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-5">
        <div className="min-w-0 space-y-5">
          {idea.scenarios.length === 0 && (
            <Card className="p-4 text-sm text-muted">
              Observation-only forward test — result:{" "}
              <span className={idea.outcome === "hit" ? "text-win" : idea.outcome === "miss" ? "text-loss" : "text-faint"}>
                {idea.outcome === "hit" ? "Hit" : idea.outcome === "miss" ? "Miss" : "pending"}
              </span>
            </Card>
          )}
          {idea.mistakes.length > 0 && (
            <Card className="border-rose-500/25">
              <CardHeader
                title="Mistakes"
                action={
                  mistakeTotal != null ? (
                    <span
                      className={cn("text-xs font-semibold tabular", mistakeTotal > 0 ? "text-loss" : mistakeTotal < 0 ? "text-win" : "text-be")}
                      title="Total for this trade: each alternative counted once, plus manual costs"
                    >
                      {fmtCost(mistakeTotal)}
                      {measured < idea.mistakes.length && <span className="font-normal text-faint"> · {measured} of {idea.mistakes.length} measured</span>}
                    </span>
                  ) : undefined
                }
              />
              <ul className="divide-y divide-line px-4 pb-2">
                {idea.mistakes.map((m) => (
                  <li key={m.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium text-loss">{m.name}</p>
                      {m.note && <p className="text-xs break-words text-muted">{m.note}</p>}
                      {m.linkedName && <p className="text-[11px] text-faint">measured against “{m.linkedName}”</p>}
                    </div>
                    {m.cost != null && (
                      <span className={cn("shrink-0 text-xs font-semibold tabular", m.cost > 0 ? "text-loss" : m.cost < 0 ? "text-win" : "text-be")}>
                        {fmtCost(m.cost)}
                        {sharedIds.has(m.id) && <span className="font-normal text-faint"> (shared)</span>}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {(idea.status === "skipped" || idea.status === "missed") && (
            <Card className="p-4">
              <p className="mb-1 text-xs font-medium text-faint">{idea.status === "skipped" ? "Why I skipped it" : "Why I missed it"}</p>
              <Markdown>{idea.skipReason}</Markdown>
            </Card>
          )}

          <Card className="space-y-4 p-4">
            <Section title="Narrative">
              <Markdown>{idea.thesis}</Markdown>
            </Section>
            <Section title="Invalidation">
              <Markdown>{idea.invalidation}</Markdown>
            </Section>
            <Section title="Review">
              <Markdown>{idea.review}</Markdown>
            </Section>
          </Card>

          <Card>
            <CardHeader title="Screenshots" />
            <div className="px-4 pb-4">
              <Gallery
                images={idea.attachments.map((a) => ({
                  src: `/api/uploads/${a.filePath}`,
                  caption: a.caption,
                  label: a.kind[0].toUpperCase() + a.kind.slice(1),
                }))}
              />
            </div>
          </Card>
        </div>

        <div className="min-w-0 space-y-5">
          <Card className="grid grid-cols-2 gap-px overflow-hidden bg-line p-0">
            <Stat label="Planned R:R" value={primary?.rr == null ? "—" : primary.rr.toFixed(2)} warn={primary?.rr != null && primary.rr < minRR} />
            <Stat
              label={hypothetical ? "Result (if taken)" : "Result"}
              value={
                primary?.exitReason === "not_filled"
                  ? "Not filled"
                  : primary?.r != null
                    ? fmtR(primary.r)
                    : idea.outcome
                      ? idea.outcome === "hit"
                        ? "Hit"
                        : "Miss"
                      : "Open"
              }
            />
            <Stat
              label="Followed plan"
              value={idea.followedPlan == null ? "—" : idea.followedPlan ? "Yes" : "No"}
              tone={idea.followedPlan == null ? undefined : idea.followedPlan ? "win" : "loss"}
            />
            <Stat label="Confidence" value={idea.confidence ? `${idea.confidence}/5` : "—"} />
            <Stat label="Risk" value={idea.riskPct != null ? `${idea.riskPct}%` : "—"} />
            <Stat label="PnL $" value={idea.pnlUsd != null ? idea.pnlUsd.toFixed(2) : "—"} />
          </Card>

          {checklist.length > 0 && (
            <Card>
              <CardHeader title="Checklist" action={<Badge>{checked}/{checklist.length}</Badge>} />
              <ul className="space-y-1.5 px-4 pb-4 text-sm">
                {checklist.map((c) => (
                  <li key={c} className="flex items-center gap-2">
                    {idea.checklistState[c] ? <Check className="h-4 w-4 text-win" /> : <Circle className="h-3.5 w-3.5 text-faint" />}
                    <span className={idea.checklistState[c] ? "text-fg" : "text-muted"}>{c}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {idea.setup && (
            <Card className="p-4">
              <p className="mb-1 text-xs font-medium text-faint">Setup rules</p>
              <Link href={`/setups/${idea.setup.id}`} className="mb-2 block text-sm font-medium hover:text-accent">
                {idea.setup.name} →
              </Link>
              <Markdown className="text-muted">{idea.setup.rules || idea.setup.description}</Markdown>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-faint">{title}</p>
      {children}
    </div>
  );
}

function Stat({ label, value, tone, warn }: { label: string; value: string; tone?: "win" | "loss"; warn?: boolean }) {
  return (
    <div className="bg-panel px-4 py-3">
      <p className="text-[11px] uppercase tracking-wider text-faint">{label}</p>
      <p className={cn("mt-0.5 text-base font-semibold tabular", tone === "win" && "text-win", tone === "loss" && "text-loss", warn && "text-warn")}>
        {value}
      </p>
    </div>
  );
}

function NavArrow({ href, label, children }: { href: string | null; label: string; children: React.ReactNode }) {
  if (!href)
    return (
      <span className="rounded-md p-1.5 text-faint/40" aria-disabled>
        {children}
      </span>
    );
  return (
    <Link href={href} className="rounded-md p-1.5 text-muted hover:bg-panel-2 hover:text-fg" aria-label={label} title={label}>
      {children}
    </Link>
  );
}
