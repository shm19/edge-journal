"use client";

import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { MistakeType, ScenarioType, Setup, Tag } from "@/db/schema";
import { saveIdea, saveScenarioType } from "@/lib/actions";
import {
  buildSavePayload,
  emptyScenario,
  hasPrices,
  isObservationOnly,
  newKey,
  patchScenario,
  removeScenario,
  toObservation,
  toPriceMode,
  type EditorIdea,
} from "@/lib/editor-shape";
import { ChecklistCard } from "./idea-editor/checklist-card";
import { ContextCard } from "./idea-editor/context-card";
import { MistakesCard } from "./idea-editor/mistakes-card";
import { NotesCard } from "./idea-editor/notes-card";
import { ScenarioCard } from "./idea-editor/scenario-card";
import { ScreenshotsCard } from "./idea-editor/screenshots-card";
import { TagsCard } from "./idea-editor/tags-card";
import { useScreenshotUpload } from "./idea-editor/use-screenshot-upload";
import { TypePicker } from "./type-picker";
import { Button, Card, CardHeader, Segmented } from "./ui";

/** The alternatives he reaches for most — shown first. */
const PINNED_TYPES = ["BE stop", "Hold to target", "Wick entry"];

export function IdeaEditor({
  initial,
  setups,
  tags,
  scenarioTypes: initialScenarioTypes,
  mistakeTypes: initialMistakeTypes,
  symbols,
  minRR,
  beThreshold,
}: {
  initial: EditorIdea;
  setups: Setup[];
  tags: Tag[];
  scenarioTypes: ScenarioType[];
  mistakeTypes: MistakeType[];
  symbols: string[];
  minRR: number;
  beThreshold: number;
}) {
  const router = useRouter();
  const [idea, setIdea] = useState<EditorIdea>(initial);
  // Local copies so types created inline show up immediately.
  const [scenarioTypes, setScenarioTypes] = useState(initialScenarioTypes);
  const [mistakeTypes, setMistakeTypes] = useState(initialMistakeTypes);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const saving = useRef(false);
  const [baseline] = useState(() => JSON.stringify(initial));
  const dirty = JSON.stringify(idea) !== baseline;

  const set = useCallback(<K extends keyof EditorIdea>(k: K, v: EditorIdea[K]) => setIdea((p) => ({ ...p, [k]: v })), []);
  const setup = setups.find((s) => s.id === idea.setupId) ?? null;
  const isForward = idea.status === "forward_test";
  // Derived, never stored: a forward test with no scenarios is a Hit / Miss observation.
  const observationOnly = isObservationOnly(idea);

  const addAttachment = useCallback(
    (filePath: string) =>
      setIdea((p) => ({
        ...p,
        attachments: [...p.attachments, { key: newKey(), filePath, caption: "", kind: p.closedAt || p.status !== "taken" ? "after" : "before" }],
      })),
    [],
  );
  const { uploading, dragOver, upload, dropProps } = useScreenshotUpload(addAttachment, setError);

  const switchObservationOnly = (on: boolean) => {
    if (!on) return setIdea(toPriceMode);
    if (idea.scenarios.some(hasPrices)) {
      const alts = idea.scenarios.filter((s) => !s.isPrimary).length;
      const what = alts ? `the primary and ${alts} alternative${alts === 1 ? "" : "s"}` : "the primary scenario";
      if (!confirm(`Switching to Hit / Miss removes ${what} and their prices. Continue?`)) return;
    }
    setIdea(toObservation);
  };

  const addAlternative = (typeId: number | null) => {
    const primary = idea.scenarios.find((s) => s.isPrimary);
    const base = primary ? { entry: primary.entry, stop: primary.stop, target: primary.target, exitPrice: "", exitReason: "" } : {};
    setIdea((p) => ({ ...p, scenarios: [...p.scenarios, { ...emptyScenario(false, typeId), ...base }] }));
  };

  // Unsaved-changes guard.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const submit = useCallback(() => {
    if (saving.current || pending) return;
    if (uploading > 0) {
      setError("Wait for screenshots to finish uploading");
      return;
    }
    setError(null);
    const built = buildSavePayload(idea);
    if (!built.ok) {
      setError(built.error);
      return;
    }
    saving.current = true;
    startTransition(async () => {
      const res = await saveIdea(built.payload);
      if (!res.ok) {
        saving.current = false;
        setError(res.error);
        return;
      }
      router.push(`/ideas/${res.data!.id}`);
      router.refresh();
    });
  }, [idea, pending, uploading, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (!e.repeat) submit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submit]);

  const orderedTypes = useMemo(() => {
    const rank = (t: ScenarioType) => {
      const i = PINNED_TYPES.indexOf(t.name);
      return i === -1 ? PINNED_TYPES.length : i;
    };
    return [...scenarioTypes].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [scenarioTypes]);

  const usedTypeIds = new Set(idea.scenarios.flatMap((s) => (s.isPrimary || s.scenarioTypeId == null ? [] : [s.scenarioTypeId])));

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-5" {...dropProps}>
      {/* ---------- Left column: context ---------- */}
      <div className="space-y-5">
        <ContextCard idea={idea} setIdea={setIdea} set={set} setups={setups} symbols={symbols} />
        {setup && setup.checklist.length > 0 && <ChecklistCard setup={setup} state={idea.checklistState} onChange={(v) => set("checklistState", v)} />}
        <TagsCard tags={tags} selected={idea.tagIds} onChange={(ids) => set("tagIds", ids)} />
      </div>

      {/* ---------- Right column: scenarios, notes, screenshots ---------- */}
      <div className="space-y-5">
        <Card>
          <CardHeader
            title={observationOnly ? "Observation" : "Scenarios"}
            description={
              observationOnly
                ? "Yes/no forward test — did the hypothesis play out?"
                : "Primary = what actually happened (or the plan, if not taken). Add alternatives to test other entries / stops / exits."
            }
            action={
              isForward ? (
                <Segmented
                  size="sm"
                  value={observationOnly ? "obs" : "prices"}
                  onChange={(v) => switchObservationOnly(v === "obs")}
                  options={[
                    { value: "prices", label: "Prices" },
                    { value: "obs", label: "Hit / Miss" },
                  ]}
                />
              ) : undefined
            }
          />
          <div className="space-y-3 px-4 pb-4">
            {isForward && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel-2/50 px-3 py-2.5">
                <span className="text-sm text-muted">Did it play out?</span>
                <Segmented
                  size="sm"
                  value={idea.outcome ?? "unset"}
                  onChange={(v) => set("outcome", v === "unset" ? null : v)}
                  options={[
                    { value: "hit", label: "Hit", tone: "bg-emerald-500/15 text-win" },
                    { value: "miss", label: "Miss", tone: "bg-rose-500/15 text-loss" },
                    { value: "unset", label: "Pending" },
                  ]}
                />
              </div>
            )}
            {!observationOnly && (
              <>
                {idea.scenarios.map((s, idx) => (
                  <ScenarioCard
                    key={s.key}
                    s={s}
                    index={idx}
                    dir={idea.direction}
                    status={idea.status}
                    minRR={minRR}
                    beThreshold={beThreshold}
                    scenarioTypes={orderedTypes}
                    onChange={(patch) => setIdea((p) => patchScenario(p, s.key, patch))}
                    onRemove={s.isPrimary ? undefined : () => setIdea((p) => removeScenario(p, s.key))}
                  />
                ))}
                <TypePicker
                  label="Add an alternative scenario"
                  hint="Same trade, different entry / stop / exit — e.g. “what if I'd moved the stop to BE”. It starts as a copy of the primary."
                  types={orderedTypes}
                  quick={orderedTypes.slice(0, 4).map((t) => t.id)}
                  usedIds={usedTypeIds}
                  onPick={(id) => addAlternative(id)}
                  createPlaceholder="e.g. Entry at 50% of thrust"
                  onCreate={async (name, description) => {
                    const res = await saveScenarioType({ name, description });
                    if (!res.ok) return { ok: false, error: res.error };
                    setScenarioTypes((list) => [...list, { id: res.data!.id, name, description }]);
                    return { ok: true, id: res.data!.id };
                  }}
                />
              </>
            )}
          </div>
        </Card>

        <NotesCard idea={idea} set={set} />
        <MistakesCard idea={idea} setIdea={setIdea} mistakeTypes={mistakeTypes} setMistakeTypes={setMistakeTypes} scenarioTypes={orderedTypes} />
        <ScreenshotsCard attachments={idea.attachments} onChange={(a) => set("attachments", a)} upload={upload} uploading={uploading} dragOver={dragOver} />

        <div className="sticky bottom-4 z-30 flex items-center justify-between gap-3 rounded-xl border border-line bg-panel/95 px-4 py-3 backdrop-blur">
          <div className="min-w-0 text-sm">
            {error ? (
              <span className="flex items-center gap-1.5 text-loss" role="alert">
                <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
              </span>
            ) : (
              <span className="text-faint">
                <kbd className="rounded border border-line px-1 text-[10px]">⌘</kbd>
                <kbd className="ml-0.5 rounded border border-line px-1 text-[10px]">Enter</kbd> to save
              </span>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                if (dirty && !confirm("Discard your unsaved changes?")) return;
                // Explicit target: history.back() would leave the app if the editor was opened in a fresh tab.
                router.push(idea.id ? `/ideas/${idea.id}` : "/ideas");
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} disabled={pending || uploading > 0}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
