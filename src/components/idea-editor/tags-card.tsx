import { useMemo } from "react";
import type { Tag } from "@/db/schema";
import { cn } from "@/lib/cn";
import { Card, CardHeader } from "../ui";

export function TagsCard({ tags, selected, onChange }: { tags: Tag[]; selected: number[]; onChange: (ids: number[]) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, Tag[]>();
    for (const t of tags) m.set(t.group, [...(m.get(t.group) ?? []), t]);
    return [...m.entries()];
  }, [tags]);
  return (
    <Card>
      <CardHeader title="Tags" description="Context, level, candle, skip reasons — anything you want to slice stats by." />
      <div className="space-y-3 px-4 pb-4">
        {groups.map(([group, list]) => (
          <div key={group}>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-faint">{group}</p>
            <div className="flex flex-wrap gap-1.5">
              {list.map((t) => {
                const on = selected.includes(t.id);
                return (
                  <button
                    type="button"
                    key={t.id}
                    aria-pressed={on}
                    onClick={() => onChange(on ? selected.filter((x) => x !== t.id) : [...selected, t.id])}
                    className={cn(
                      "rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                      on ? "" : "border-line text-muted hover:border-line-strong hover:text-fg",
                    )}
                    style={on ? { color: t.color, borderColor: `${t.color}88`, backgroundColor: `${t.color}22` } : undefined}
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {!tags.length && <p className="text-sm text-faint">No tags yet — add them in Settings.</p>}
      </div>
    </Card>
  );
}
