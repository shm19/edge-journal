import { fmtPct } from "@/lib/format";
import type { Summary } from "@/lib/stats";
import { RValue } from "./bits";

export interface BreakdownRow {
  key: string;
  /** Replaces the plain key (a link, a badge, …). */
  label?: React.ReactNode;
  summary: Summary;
}

/** One row per group: label, n, win rate and an R value (expectancy or total). Shared by the dashboard, setup and skips cards. */
export function BreakdownList({
  rows,
  value,
  empty,
}: {
  rows: BreakdownRow[];
  value: "expectancy" | "totalR";
  empty: string;
}) {
  return (
    <ul className="divide-y divide-line px-4 pb-2 text-sm">
      {rows.map((g) => (
        <li key={g.key} className="flex items-center justify-between gap-2 py-2">
          <span className="min-w-0 flex-1 truncate">{g.label ?? g.key}</span>
          <span className="flex shrink-0 items-center gap-3 text-xs tabular">
            <span className="text-faint">n={g.summary.count}</span>
            <span className="text-muted">{fmtPct(g.summary.winRate)}</span>
            <RValue r={g.summary[value]} be={0} />
          </span>
        </li>
      ))}
      {!rows.length && <li className="py-3 text-faint">{empty}</li>}
    </ul>
  );
}
