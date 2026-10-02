import { Link2, Trash2 } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { MistakeType, ScenarioType } from "@/db/schema";
import { saveMistakeType } from "@/lib/actions";
import { cn } from "@/lib/cn";
import { fmtCost } from "@/lib/format";
import { editorMistakeCost, newKey, parseCost, type EditorIdea, type EditorMistake } from "@/lib/editor-shape";
import { TypePicker } from "../type-picker";
import { Badge, Card, CardHeader } from "../ui";

export function MistakesCard({
  idea,
  setIdea,
  mistakeTypes,
  setMistakeTypes,
  scenarioTypes,
}: {
  idea: EditorIdea;
  setIdea: Dispatch<SetStateAction<EditorIdea>>;
  mistakeTypes: MistakeType[];
  setMistakeTypes: Dispatch<SetStateAction<MistakeType[]>>;
  scenarioTypes: ScenarioType[];
}) {
  const addMistake = (typeId: number) =>
    setIdea((p) => ({
      ...p,
      // Logging a mistake on a taken trade means the plan wasn't followed (unless already answered).
      followedPlan: p.status === "taken" && p.followedPlan == null ? false : p.followedPlan,
      mistakes: [...p.mistakes, { key: newKey(), mistakeTypeId: typeId, note: "", costR: "", scenarioKey: null }],
    }));
  const updateMistake = (key: string, patch: Partial<EditorMistake>) =>
    setIdea((p) => ({ ...p, mistakes: p.mistakes.map((m) => (m.key === key ? { ...m, ...patch } : m)) }));
  const alternatives = idea.scenarios.filter((x) => !x.isPrimary);

  return (
    <Card>
      <CardHeader
        title="Mistakes"
        description="What went wrong? Link a mistake to an alternative to measure what it cost you."
        action={idea.mistakes.length ? <Badge className="border-rose-500/30 bg-rose-500/10 text-loss">{idea.mistakes.length}</Badge> : undefined}
      />
      <div className="space-y-2.5 px-4 pb-4">
        {idea.mistakes.map((m) => {
          const type = mistakeTypes.find((t) => t.id === m.mistakeTypeId);
          const cost = editorMistakeCost(idea, m);
          const badCost = parseCost(m.costR).invalid;
          return (
            <div key={m.key} className="rounded-lg border border-rose-500/25 bg-rose-500/[0.04] p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-loss">{type?.name ?? "Mistake"}</span>
                <span className="flex items-center gap-2">
                  {cost != null && (
                    <span className={cn("text-xs font-semibold tabular", cost > 0 ? "text-loss" : "text-win")} title="R lost because of this mistake">
                      {fmtCost(cost)}
                      {cost !== 0 && ` ${cost > 0 ? "lost" : "saved"}`}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setIdea((p) => ({ ...p, mistakes: p.mistakes.filter((x) => x.key !== m.key) }))}
                    className="rounded p-1 text-faint hover:bg-panel-3 hover:text-loss"
                    aria-label={`Remove mistake ${type?.name ?? ""}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              </div>
              <input
                value={m.note}
                onChange={(e) => updateMistake(m.key, { note: e.target.value })}
                placeholder="What happened? (e.g. moved stop to BE after +1R, got wicked out)"
                aria-label="Mistake note"
                className="mb-2 w-full rounded-md border border-line bg-panel px-2 py-1.5 text-xs placeholder:text-faint"
              />
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Link2 className="h-3.5 w-3.5 text-faint" />
                <select
                  value={m.scenarioKey ?? ""}
                  onChange={(e) => updateMistake(m.key, { scenarioKey: e.target.value || null })}
                  className="h-7 rounded-md border border-line bg-panel px-1.5 text-xs text-muted"
                  aria-label="Measure against alternative"
                >
                  <option value="">{alternatives.length ? "Measure against an alternative…" : "No alternatives yet"}</option>
                  {alternatives.map((x, i) => (
                    <option key={x.key} value={x.key}>
                      {scenarioTypes.find((t) => t.id === x.scenarioTypeId)?.name ?? `Alternative #${i + 1}`}
                    </option>
                  ))}
                </select>
                <span className="text-faint">or cost</span>
                <input
                  inputMode="decimal"
                  value={m.costR}
                  onChange={(e) => updateMistake(m.key, { costR: e.target.value.replace(/[^0-9.,-]/g, "") })}
                  placeholder="R lost"
                  title="positive = lost, negative = saved"
                  aria-label="Cost in R"
                  aria-invalid={badCost || undefined}
                  className={cn("h-7 w-16 rounded-md border bg-panel px-1.5 text-xs tabular", badCost ? "border-rose-500/60" : "border-line")}
                />
                <span className="text-faint">R</span>
                {badCost && <span className="text-[10px] text-loss">Not a number</span>}
              </div>
            </div>
          );
        })}
        <TypePicker
          tone="loss"
          label={idea.mistakes.length ? "Add another mistake" : "Record a mistake"}
          types={mistakeTypes}
          quick={mistakeTypes.slice(0, 6).map((t) => t.id)}
          usedIds={new Set(idea.mistakes.map((m) => m.mistakeTypeId))}
          onPick={addMistake}
          createPlaceholder="e.g. Entered before candle close"
          onCreate={async (name, description) => {
            const res = await saveMistakeType({ name, description });
            if (!res.ok) return { ok: false, error: res.error };
            setMistakeTypes((list) => [...list, { id: res.data!.id, name, description }].sort((a, b) => a.name.localeCompare(b.name)));
            return { ok: true, id: res.data!.id };
          }}
        />
      </div>
    </Card>
  );
}
