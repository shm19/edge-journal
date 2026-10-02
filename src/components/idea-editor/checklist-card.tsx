import { Check } from "lucide-react";
import type { Setup } from "@/db/schema";
import { cn } from "@/lib/cn";
import { Badge, Card, CardHeader } from "../ui";

export function ChecklistCard({
  setup,
  state,
  onChange,
}: {
  setup: Pick<Setup, "name" | "checklist">;
  state: Record<string, boolean>;
  onChange: (next: Record<string, boolean>) => void;
}) {
  const checklist = setup.checklist;
  const checkedCount = checklist.filter((c) => state[c]).length;
  return (
    <Card>
      <CardHeader
        title="Setup checklist"
        description={setup.name}
        action={<Badge className={checkedCount === checklist.length ? "text-win" : undefined}>{checkedCount}/{checklist.length}</Badge>}
      />
      <div className="space-y-1 px-4 pb-4">
        {checklist.map((item) => {
          const on = !!state[item];
          return (
            <button
              type="button"
              role="checkbox"
              aria-checked={on}
              key={item}
              onClick={() => onChange({ ...state, [item]: !on })}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-panel-2"
            >
              <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded border", on ? "border-win bg-win/20 text-win" : "border-line-strong")}>
                {on && <Check className="h-3 w-3" />}
              </span>
              <span className={on ? "text-fg" : "text-muted"}>{item}</span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
