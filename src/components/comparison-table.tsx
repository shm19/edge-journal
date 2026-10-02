import { cn } from "@/lib/cn";
import { fmtPct, fmtR } from "@/lib/format";
import type { Comparison } from "@/lib/stats";
import { RValue, SampleBadge } from "./bits";

export function ComparisonTable({ rows }: { rows: (Comparison & { name: string })[] }) {
  if (!rows.length)
    return (
      <p className="px-4 pb-4 text-sm text-faint">
        No closed alternatives yet. In the idea editor, add an alternative (e.g. “BE stop”, “Wick entry”) and fill its exit to compare.
      </p>
    );
  return (
    <div className="overflow-x-auto px-2 pb-3">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-faint">
            <th className="px-2 py-2 font-medium">Alternative</th>
            <th className="px-2 py-2 text-right font-medium">Pairs</th>
            <th className="px-2 py-2 text-right font-medium">Actual total</th>
            <th className="px-2 py-2 text-right font-medium">Alt total</th>
            <th className="px-2 py-2 text-right font-medium">Δ total</th>
            <th className="px-2 py-2 text-right font-medium">Δ expectancy</th>
            <th className="px-2 py-2 text-right font-medium">Win rate (act → alt)</th>
            <th className="px-2 py-2 text-right font-medium">Alt better</th>
          </tr>
        </thead>
        <tbody className="tabular">
          {rows.map((r) => (
            <tr key={r.name} className="border-t border-line">
              <td className="px-2 py-2">
                <p className="font-medium">{r.name}</p>
                <SampleBadge n={r.pairs} />
              </td>
              <td className="px-2 py-2 text-right">{r.pairs}</td>
              <td className="px-2 py-2 text-right">
                <RValue r={r.primary.totalR} be={0} />
              </td>
              <td className="px-2 py-2 text-right">
                <RValue r={r.variant.totalR} be={0} />
              </td>
              <td className={cn("px-2 py-2 text-right font-semibold", r.deltaTotalR > 0 ? "text-win" : r.deltaTotalR < 0 ? "text-loss" : "text-be")}>
                {fmtR(r.deltaTotalR)}
              </td>
              <td className="px-2 py-2 text-right">{fmtR(r.deltaExpectancy)}</td>
              <td className="px-2 py-2 text-right text-muted">
                {fmtPct(r.primary.winRate)} → <span className="text-fg">{fmtPct(r.variant.winRate)}</span>
              </td>
              <td className="px-2 py-2 text-right text-muted">
                {r.variantBetterCount}/{r.pairs}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
