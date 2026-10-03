import { ImageIcon } from "lucide-react";
import Link from "next/link";
import type { IdeaView } from "@/lib/queries";
import { fmtDate, fmtPrice } from "@/lib/format";
import { isHypothetical } from "@/lib/status";
import { DirectionBadge, RValue, SetupBadge, StatusBadge, TagChip } from "./bits";

// Tight cell padding: at the 1024px minimum width the content column is only ~735px wide.
const TH = "px-2 py-2.5";
const TD = "px-2 py-2.5";

// overflow-x-auto is the safety net; Entry and Tags are hidden below xl so the table fits the 1024px minimum without it.
export function IdeaTable({ ideas, be }: { ideas: IdeaView[]; be: number }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full text-sm">
        <thead className="bg-panel">
          <tr className="text-left text-[11px] uppercase tracking-wider text-faint">
            <th className={`${TH} font-medium`}>Date</th>
            <th className={`${TH} font-medium`}>Coin</th>
            <th className={`${TH} font-medium`}>Setup</th>
            <th className={`${TH} font-medium`}>Status</th>
            <th className={`${TH} text-right font-medium`}>R</th>
            <th className={`${TH} hidden text-right font-medium xl:table-cell`}>Entry</th>
            <th className={`${TH} text-right font-medium`}>R:R</th>
            <th className={`${TH} text-right font-medium`}>Alts</th>
            <th className={`${TH} hidden font-medium xl:table-cell`}>Tags</th>
          </tr>
        </thead>
        <tbody>
          {ideas.map((i) => {
            const alts = i.scenarios.filter((s) => !s.isPrimary);
            return (
              <tr key={i.id} className="group border-t border-line bg-panel/40 hover:bg-panel-2/70">
                <td className={`${TD} whitespace-nowrap text-muted`}>
                  <Link href={`/ideas/${i.id}`} className="block">
                    {fmtDate(i.openedAt)}
                  </Link>
                </td>
                <td className={TD}>
                  <Link href={`/ideas/${i.id}`} className="flex items-center gap-2 font-medium">
                    {i.symbol} <DirectionBadge direction={i.direction} />
                    {i.attachments.length > 0 && <ImageIcon className="h-3.5 w-3.5 text-faint" />}
                    {i.mistakes.length > 0 && (
                      <span className="rounded bg-rose-500/15 px-1 text-[10px] font-semibold whitespace-nowrap text-loss" title={i.mistakes.map((m) => m.name).join(", ")}>
                        {i.mistakes.length} mistake{i.mistakes.length > 1 ? "s" : ""}
                      </span>
                    )}
                  </Link>
                </td>
                <td className={`${TD} max-w-36`}>
                  <SetupBadge setup={i.setup} />
                </td>
                <td className={`${TD} whitespace-nowrap`}>
                  <StatusBadge status={i.status} />
                </td>
                <td className={`${TD} text-right whitespace-nowrap`}>
                  <ResultCell idea={i} be={be} />
                </td>
                <td className={`${TD} hidden text-right tabular text-muted xl:table-cell`}>{fmtPrice(i.primary?.entry)}</td>
                <td className={`${TD} text-right tabular text-muted`}>{i.primary?.rr == null ? "—" : i.primary.rr.toFixed(1)}</td>
                <td className={`${TD} text-right text-xs text-faint`}>
                  {alts.length ? (
                    <span title={alts.map((a) => `${a.typeName ?? "Alt"}: ${a.r == null ? "open" : a.r.toFixed(2) + "R"}`).join("\n")}>
                      {alts.length}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className={`${TD} hidden max-w-48 xl:table-cell`}>
                  <div className="flex flex-wrap gap-1">
                    {i.tags.slice(0, 4).map((t) => (
                      <TagChip key={t.id} tag={t} />
                    ))}
                    {i.tags.length > 4 && <span className="text-[11px] text-faint">+{i.tags.length - 4}</span>}
                  </div>
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
  return (
    <>
      {isHypothetical(idea.status) && <span className="mr-1 text-[10px] whitespace-nowrap text-faint">if taken</span>}
      <RValue r={idea.primary.r} be={be} />
    </>
  );
}
