"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { cn } from "@/lib/cn";
import { METRICS } from "@/lib/metrics";
import { Select } from "./ui";


export function AnalyticsControls({
  dimensions,
  group,
  metric,
  tab,
}: {
  dimensions: { key: string; label: string }[];
  group: string;
  metric: string;
  tab: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [, start] = useTransition();
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(sp.toString());
    next.set(k, v);
    start(() => router.replace(`${pathname}?${next}`, { scroll: false }));
  };

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex rounded-lg border border-line bg-panel-2 p-0.5">
        {[
          { k: "breakdown", l: "Breakdown" },
          { k: "alternatives", l: "Alternatives" },
          { k: "skips", l: "Skipped & missed" },
        ].map((t) => (
          <button
            key={t.k}
            type="button"
            onClick={() => set("tab", t.k)}
            className={cn("rounded-md px-3 py-1.5 text-xs font-medium", tab === t.k ? "bg-panel-3 text-fg" : "text-muted hover:text-fg")}
          >
            {t.l}
          </button>
        ))}
      </div>
      {tab === "breakdown" && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          Group by
          <Select size="sm" value={group} onChange={(e) => set("group", e.target.value)} aria-label="Group by">
            {dimensions.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </Select>
          Chart
          <Select size="sm" value={metric} onChange={(e) => set("metric", e.target.value)} aria-label="Metric">
            {METRICS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </Select>
        </div>
      )}
    </div>
  );
}
