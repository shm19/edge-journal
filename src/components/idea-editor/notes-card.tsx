import { cn } from "@/lib/cn";
import type { EditorIdea } from "@/lib/editor-shape";
import { Card, Field, Input, Segmented, Textarea } from "../ui";

/** Skip reason, narrative, invalidation, review, followed-plan, confidence and the optional money fields. */
export function NotesCard({ idea, set }: { idea: EditorIdea; set: <K extends keyof EditorIdea>(k: K, v: EditorIdea[K]) => void }) {
  const isSkip = idea.status === "skipped" || idea.status === "missed";
  return (
    <Card className="p-4">
      <div className="grid gap-4">
        {isSkip && (
          <Field
            label={idea.status === "skipped" ? "Why did you skip it?" : "Why did you miss it?"}
            hint="Also tag it under “Skip reason” so you can compare reasons in Analytics."
            htmlFor="idea-skip"
          >
            <Textarea
              id="idea-skip"
              value={idea.skipReason}
              onChange={(e) => set("skipReason", e.target.value)}
              placeholder="e.g. R to FTA too small, price drifting into level, didn't trust the LLPB shape…"
              className="min-h-16"
            />
          </Field>
        )}
        <Field label="Narrative / reason for the trade" hint="Markdown supported. What's the story? Which options did you consider?" htmlFor="idea-thesis">
          <Textarea
            id="idea-thesis"
            value={idea.thesis}
            onChange={(e) => set("thesis", e.target.value)}
            placeholder="HTF: … Level: … Why here, why now? Where's the FTA?"
            className="min-h-28"
          />
        </Field>
        <Field label="Invalidation" hint="If A plays out, B should happen. What would prove you wrong?" htmlFor="idea-invalidation">
          <Textarea id="idea-invalidation" value={idea.invalidation} onChange={(e) => set("invalidation", e.target.value)} className="min-h-16" />
        </Field>
        <Field label="Review (after)" hint="What happened? What would you do differently?" htmlFor="idea-review">
          <Textarea id="idea-review" value={idea.review} onChange={(e) => set("review", e.target.value)} className="min-h-24" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          {idea.status === "taken" && (
            <Field label="Followed my plan?">
              <Segmented
                value={idea.followedPlan == null ? "unset" : idea.followedPlan ? "yes" : "no"}
                onChange={(v) => set("followedPlan", v === "unset" ? null : v === "yes")}
                options={[
                  { value: "yes", label: "Yes", tone: "bg-emerald-500/15 text-win" },
                  { value: "no", label: "No", tone: "bg-rose-500/15 text-loss" },
                  { value: "unset", label: "—" },
                ]}
                size="sm"
              />
            </Field>
          )}
          <Field label="Confidence in the setup">
            <div className="flex gap-1" role="radiogroup" aria-label="Confidence">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={idea.confidence === n}
                  aria-label={`${n} of 5`}
                  key={n}
                  onClick={() => set("confidence", idea.confidence === n ? null : n)}
                  className={cn(
                    "h-8 w-8 rounded-md border text-sm font-medium",
                    idea.confidence != null && n <= idea.confidence ? "border-accent/60 bg-accent/15 text-accent" : "border-line text-faint hover:text-fg",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </Field>
        </div>
        <details className="group rounded-lg border border-line px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-muted">Money (optional)</summary>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Field label="Risk % of account" htmlFor="idea-risk">
              <Input id="idea-risk" inputMode="decimal" value={idea.riskPct} onChange={(e) => set("riskPct", e.target.value)} placeholder="1" />
            </Field>
            <Field label="PnL $" htmlFor="idea-pnl">
              <Input id="idea-pnl" inputMode="decimal" value={idea.pnlUsd} onChange={(e) => set("pnlUsd", e.target.value)} />
            </Field>
            <Field label="Fees $" htmlFor="idea-fees">
              <Input id="idea-fees" inputMode="decimal" value={idea.feesUsd} onChange={(e) => set("feesUsd", e.target.value)} />
            </Field>
          </div>
        </details>
      </div>
    </Card>
  );
}
