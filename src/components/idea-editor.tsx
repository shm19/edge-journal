"use client";

import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { MistakeType, ScenarioType, Setup, Tag } from "@/db/schema";
import { saveIdea, saveScenarioType } from "@/lib/actions";
import {
  buildSavePayload,
  emptyScenario,
  errorField,
  hasPrices,
  inlineMessage,
  isObservationOnly,
  newKey,
  patchScenario,
  pricesReady,
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
  // Set once a save succeeded, so the unsaved-changes guards let the redirect through.
  const saved = useRef(false);
  // The field a failed save points at. Shown only while the form is unchanged since that save (any edit clears it).
  const [failed, setFailed] = useState<{ id: string; message: string; at: EditorIdea } | null>(null);
  // Date boxes holding text that is not a valid date-time; saving is blocked meanwhile (it would drop the text).
  const [invalidDates, setInvalidDates] = useState<string[]>([]);
  const onInvalidDate = useCallback(
    (label: string, invalid: boolean) =>
      setInvalidDates((p) => (p.includes(label) === invalid ? p : invalid ? [...p, label] : p.filter((l) => l !== label))),
    [],
  );
  const [baseline] = useState(() => JSON.stringify(initial));
  const dirty = JSON.stringify(idea) !== baseline;
  const fieldError = failed && failed.at === idea ? failed : null;

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
  const { uploading, uploadError, dragOver, upload, dropProps } = useScreenshotUpload(addAttachment);

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

  // Unsaved-changes guard: reload / close tab (browser prompt) and in-app links (same confirm as Cancel).
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!saved.current) e.preventDefault();
    };
    const onClick = (e: MouseEvent) => {
      if (saved.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const to = new URL(a.href, window.location.href);
      if (to.origin !== window.location.origin || (to.pathname === window.location.pathname && to.search === window.location.search)) return;
      if (!confirm("Discard your unsaved changes?")) {
        e.preventDefault();
        e.stopPropagation(); // capture phase: Next's Link handler never sees the click
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  /** Show a save error in the bar and, when it is about one field, mark that field, scroll to it and focus it. */
  const fail = useCallback(
    (message: string, field = errorField(message, idea.scenarios)) => {
      setError(message);
      if (!field) return;
      setFailed({ id: field, message: inlineMessage(message), at: idea });
      const el = document.getElementById(field);
      el?.scrollIntoView({ block: "center" });
      el?.focus({ preventScroll: true });
    },
    [idea],
  );

  const submit = useCallback(() => {
    if (saving.current || pending) return;
    if (uploading > 0) {
      setError("Wait for screenshots to finish uploading");
      return;
    }
    setError(null);
    setFailed(null);
    if (invalidDates.length) {
      fail(`Fix the ${invalidDates.join(" and ")} date first: use YYYY-MM-DD HH:mm (UTC).`, `idea-${invalidDates[0].toLowerCase()}`);
      return;
    }
    const built = buildSavePayload(idea);
    if (!built.ok) {
      fail(built.error, built.field);
      return;
    }
    saving.current = true;
    startTransition(async () => {
      const res = await saveIdea(built.payload);
      if (!res.ok) {
        saving.current = false;
        fail(res.error);
        return;
      }
      saved.current = true;
      // replace, not push: Back from the saved idea must not return to this form.
      router.replace(`/ideas/${res.data!.id}`);
      router.refresh();
    });
  }, [idea, pending, uploading, invalidDates, router, fail]);

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
        <ContextCard idea={idea} setIdea={setIdea} set={set} setups={setups} symbols={symbols} onInvalidDate={onInvalidDate} fieldError={fieldError} />
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
            {isForward && (observationOnly || pricesReady(idea)) && (
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
            {isForward && !observationOnly && !pricesReady(idea) && (
              <p className="text-xs text-muted">
                Fill in entry and stop to track prices. For a plain yes / no result, switch to <strong className="font-medium text-fg">Hit / Miss</strong> above.
              </p>
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
                    fieldError={fieldError}
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
        <ScreenshotsCard attachments={idea.attachments} onChange={(a) => set("attachments", a)} upload={upload} uploading={uploading} uploadError={uploadError} dragOver={dragOver} />

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
