import { ImageIcon } from "lucide-react";
import Link from "next/link";
import type { IdeaView } from "@/lib/queries";
import { fmtDate, fmtPrice } from "@/lib/format";
import { DirectionBadge, RValue, SetupBadge, StatusBadge, TagChip } from "./bits";

export function IdeaTable({ ideas, be }: { ideas: IdeaView[]; be: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <table className="w-full text-sm">
        <thead className="bg-panel">
          <tr className="text-left text-[11px] uppercase tracking-wider text-faint">
            <th className="px-3 py-2.5 font-medium">Date</th>
            <th className="px-3 py-2.5 font-medium">Coin</th>
            <th className="px-3 py-2.5 font-medium">Setup</th>
            <th className="px-3 py-2.5 font-medium">Status</th>
            <th className="px-3 py-2.5 font-medium">Tags</th>
            <th className="px-3 py-2.5 text-right font-medium">Entry</th>
            <th className="px-3 py-2.5 text-right font-medium">R:R</th>
            <th className="px-3 py-2.5 text-right font-medium">R</th>
            <th className="px-3 py-2.5 text-right font-medium">Alts</th>
          </tr>
        </thead>
        <tbody>
          {ideas.map((i) => {
            const alts = i.scenarios.filter((s) => !s.isPrimary);
            return (
              <tr key={i.id} className="group border-t border-line bg-panel/40 hover:bg-panel-2/70">
                <td className="px-3 py-2.5 whitespace-nowrap text-muted">
                  <Link href={`/ideas/${i.id}`} className="block">
                    {fmtDate(i.openedAt)}
                  </Link>
                </td>
                <td className="px-3 py-2.5">
                  <Link href={`/ideas/${i.id}`} className="flex items-center gap-2 font-medium">
                    {i.symbol} <DirectionBadge direction={i.direction} />
                    {i.attachments.length > 0 && <ImageIcon className="h-3.5 w-3.5 text-faint" />}
                    {i.mistakes.length > 0 && (
                      <span className="rounded bg-rose-500/15 px-1 text-[10px] font-semibold text-loss" title={i.mistakes.map((m) => m.name).join(", ")}>
                        {i.mistakes.length} mistake{i.mistakes.length > 1 ? "s" : ""}
                      </span>
                    )}
                  </Link>
                </td>
                <td className="max-w-48 px-3 py-2.5">
                  <SetupBadge setup={i.setup} />
                </td>
                <td className="px-3 py-2.5">
                  <StatusBadge status={i.status} />
                </td>
                <td className="max-w-64 px-3 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {i.tags.slice(0, 4).map((t) => (
                      <TagChip key={t.id} tag={t} />
                    ))}
                    {i.tags.length > 4 && <span className="text-[11px] text-faint">+{i.tags.length - 4}</span>}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right tabular text-muted">{fmtPrice(i.primary?.entry)}</td>
                <td className="px-3 py-2.5 text-right tabular text-muted">{i.primary?.rr == null ? "—" : i.primary.rr.toFixed(1)}</td>
                <td className="px-3 py-2.5 text-right">
                  <ResultCell idea={i} be={be} />
                </td>
                <td className="px-3 py-2.5 text-right text-xs text-faint">
                  {alts.length ? (
                    <span title={alts.map((a) => `${a.typeName ?? "Alt"}: ${a.r == null ? "open" : a.r.toFixed(2) + "R"}`).join("\n")}>
                      {alts.length}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ResultCell({ idea, be }: { idea: IdeaView; be: number }) {
  if (idea.outcome) return <span className={idea.outcome === "hit" ? "text-sm font-semibold text-win" : "text-sm font-semibold text-loss"}>{idea.outcome === "hit" ? "Hit" : "Miss"}</span>;
  if (idea.primary?.exitReason === "not_filled") return <span className="text-xs text-faint">not filled</span>;
  if (idea.primary?.r == null) return <span className="text-xs text-faint">{idea.primary ? "open" : "pending"}</span>;
  return <RValue r={idea.primary.r} be={be} />;
}
