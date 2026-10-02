"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { Setup, Tag } from "@/db/schema";
import { BIASES, IDEA_STATUSES, TIMEFRAMES } from "@/db/schema";
import { cn } from "@/lib/cn";
import { BIAS_LABEL, STATUS_LABEL } from "@/lib/format";

const sel = "h-8 rounded-lg border border-line bg-panel-2 px-2 text-xs text-fg focus:outline-none focus:border-accent/60";

export function FilterBar({
  setups,
  tags,
  symbols,
  showStatus = true,
  defaultStatus,
}: {
  setups: Pick<Setup, "id" | "name">[];
  tags: Pick<Tag, "id" | "name" | "group">[];
  symbols: string[];
  showStatus?: boolean;
  defaultStatus?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [, start] = useTransition();
  const [q, setQ] = useState(sp.get("q") ?? "");

  const update = (patch: Record<string, string | null>) => {
    // Read the live URL, not the render-time snapshot (the debounced search would otherwise resurrect cleared filters).
    const next = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "") next.delete(k);
      else next.set(k, v);
    }
    start(() => router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false }));
  };

  // Debounced search.
  useEffect(() => {
    const t = setTimeout(() => {
      if ((new URLSearchParams(window.location.search).get("q") ?? "") !== q) update({ q });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const statuses = (sp.get("status") ?? defaultStatus ?? "").split(",").filter(Boolean);
  const toggleStatus = (s: string) => {
    const set = new Set(statuses);
    if (set.has(s)) set.delete(s);
    else set.add(s);
    update({ status: [...set].join(",") || (defaultStatus ? "none" : null) });
  };
  const active = [...sp.keys()].filter((k) => k !== "group" && k !== "metric" && k !== "tab").length > 0 || q !== "";

  const tagGroups = [...new Set(tags.map((t) => t.group))];

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {showStatus && (
        <div className="flex flex-wrap gap-1">
          {IDEA_STATUSES.map((s) => {
            const on = statuses.includes(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleStatus(s)}
                className={cn(
                  "h-8 rounded-lg border px-2.5 text-xs font-medium transition-colors",
                  on ? "border-accent/50 bg-accent/15 text-fg" : "border-line text-muted hover:text-fg",
                )}
              >
                {STATUS_LABEL[s]}
              </button>
            );
          })}
        </div>
      )}
      <select className={sel} value={sp.get("setup") ?? ""} onChange={(e) => update({ setup: e.target.value })} aria-label="Setup">
        <option value="">All setups</option>
        {setups.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <select className={sel} value={sp.get("symbol") ?? ""} onChange={(e) => update({ symbol: e.target.value })} aria-label="Coin">
        <option value="">All coins</option>
        {symbols.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <select className={sel} value={sp.get("tag") ?? ""} onChange={(e) => update({ tag: e.target.value })} aria-label="Tag">
        <option value="">Any tag</option>
        {tagGroups.map((g) => (
          <optgroup key={g} label={g}>
            {tags
              .filter((t) => t.group === g)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      <select className={sel} value={sp.get("tf") ?? ""} onChange={(e) => update({ tf: e.target.value })} aria-label="Timeframe">
        <option value="">Any TF</option>
        {TIMEFRAMES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <select className={sel} value={sp.get("bias") ?? ""} onChange={(e) => update({ bias: e.target.value })} aria-label="HTF bias">
        <option value="">Any bias</option>
        {BIASES.map((b) => (
          <option key={b} value={b}>
            {BIAS_LABEL[b]}
          </option>
        ))}
      </select>
      <select className={sel} value={sp.get("dir") ?? ""} onChange={(e) => update({ dir: e.target.value })} aria-label="Direction">
        <option value="">Long & short</option>
        <option value="long">Long</option>
        <option value="short">Short</option>
      </select>
      <input type="date" className={sel} value={sp.get("from") ?? ""} onChange={(e) => update({ from: e.target.value })} aria-label="From" />
      <input type="date" className={sel} value={sp.get("to") ?? ""} onChange={(e) => update({ to: e.target.value })} aria-label="To" />
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes…" className={cn(sel, "w-40 pl-7")} />
      </div>
      {active && (
        <button
          type="button"
          onClick={() => {
            setQ("");
            const keep = new URLSearchParams();
            for (const k of ["group", "metric", "tab"]) {
              const v = sp.get(k);
              if (v) keep.set(k, v);
            }
            start(() => router.replace(`${pathname}${keep.size ? `?${keep}` : ""}`, { scroll: false }));
          }}
          className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-muted hover:text-fg"
        >
          <X className="h-3.5 w-3.5" /> Clear
        </button>
      )}
    </div>
  );
}
