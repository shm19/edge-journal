"use client";

import { AlertTriangle, Check, ImagePlus, Link2, Loader2, Target, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { MistakeType, ScenarioType, Setup, Tag } from "@/db/schema";
import { BIASES, EXIT_REASONS, IDEA_STATUSES, REGIMES, TIMEFRAMES } from "@/db/schema";
import { saveIdea, saveMistakeType, saveScenarioType } from "@/lib/actions";
import { cn } from "@/lib/cn";
import { emptyScenario, type EditorAttachment, type EditorIdea, type EditorMistake, type EditorScenario } from "@/lib/editor-shape";
import { BIAS_LABEL, EXIT_LABEL, fmtR, REGIME_LABEL, rTone, STATUS_LABEL } from "@/lib/format";
import { parsePrice } from "@/lib/price";
import { mistakeCost, plannedRR, scenarioR, stopIsValid } from "@/lib/stats";
import { isoToZonedInput, zonedInputToIso } from "@/lib/tz";
import { TypePicker } from "./type-picker";
import { Badge, Button, Card, CardHeader, Field, Input, Segmented, Select, Textarea } from "./ui";

type Dir = "long" | "short";

const newKey = () => `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
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
  const [observationOnly, setObservationOnly] = useState(
    initial.id != null && initial.status === "forward_test" && initial.scenarios.length === 0,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const saving = useRef(false);
  const [baseline] = useState(() => JSON.stringify(initial));
  const dirty = JSON.stringify(idea) !== baseline;

  const set = useCallback(<K extends keyof EditorIdea>(k: K, v: EditorIdea[K]) => setIdea((p) => ({ ...p, [k]: v })), []);
  const setup = setups.find((s) => s.id === idea.setupId) ?? null;
  const isTaken = idea.status === "taken";
  const isSkip = idea.status === "skipped" || idea.status === "missed";
  const isForward = idea.status === "forward_test";
  const showScenarios = !(isForward && observationOnly);

  const switchObservationOnly = (on: boolean) => {
    setObservationOnly(on);
    // Switching back to prices: make sure there is a primary scenario to fill.
    if (!on) setIdea((p) => (p.scenarios.some((s) => s.isPrimary) ? p : { ...p, scenarios: [emptyScenario(true), ...p.scenarios] }));
  };

  const updateScenario = (key: string, patch: Partial<EditorScenario>) =>
    setIdea((p) => {
      const scenarios = p.scenarios.map((s) => (s.key === key ? { ...s, ...patch } : s));
      const target = scenarios.find((s) => s.key === key);
      // Closing the primary with no close time → stamp "now" (editable).
      const closes = target?.isPrimary && ((patch.exitPrice ?? "") !== "" || patch.exitReason === "not_filled");
      return { ...p, scenarios, closedAt: closes && !p.closedAt ? new Date().toISOString() : p.closedAt };
    });

  const addMistake = (typeId: number) => {
    setIdea((p) => ({
      ...p,
      // Logging a mistake on a taken trade means the plan wasn't followed (unless already answered).
      followedPlan: p.status === "taken" && p.followedPlan == null ? false : p.followedPlan,
      mistakes: [...p.mistakes, { key: newKey(), mistakeTypeId: typeId, note: "", costR: "", scenarioKey: null }],
    }));
  };
  const updateMistake = (key: string, patch: Partial<EditorMistake>) =>
    setIdea((p) => ({ ...p, mistakes: p.mistakes.map((m) => (m.key === key ? { ...m, ...patch } : m)) }));

  const addAlternative = (typeId: number | null) => {
    const primary = idea.scenarios.find((s) => s.isPrimary);
    const base = primary ? { entry: primary.entry, stop: primary.stop, target: primary.target, exitPrice: "", exitReason: "" } : {};
    setIdea((p) => ({ ...p, scenarios: [...p.scenarios, { ...emptyScenario(false, typeId), ...base }] }));
  };

  // ---------- Unsaved-changes guard ----------
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // ---------- Screenshots ----------
  const upload = useCallback(async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (files.length && !images.length) {
      setError("Only images can be attached (PNG, JPG, WEBP, GIF)");
      return;
    }
    if (!images.length) return;
    setUploading((n) => n + images.length);
    for (const file of images) {
      try {
        if (file.size > 10 * 1024 * 1024) throw new Error(`${file.name || "Image"} is larger than 10 MB`);
        const body = new FormData();
        body.append("file", file);
        const res = await fetch("/api/uploads", { method: "POST", body });
        const json = (await res.json().catch(() => ({}))) as { fileName?: string; error?: string };
        if (!res.ok || !json.fileName) throw new Error(json.error ?? `Upload failed (${res.status})`);
        setIdea((p) => ({
          ...p,
          attachments: [
            ...p.attachments,
            { key: newKey(), filePath: json.fileName!, caption: "", kind: p.closedAt || p.status !== "taken" ? "after" : "before" },
          ],
        }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }, []);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (files.length) {
        e.preventDefault();
        void upload(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [upload]);

  // ---------- Save ----------
  const submit = useCallback(() => {
    if (saving.current || pending) return;
    if (uploading > 0) {
      setError("Wait for screenshots to finish uploading");
      return;
    }
    setError(null);
    const scenarios = showScenarios ? idea.scenarios : [];
    const parsed = scenarios.map((s) => ({
      id: s.id,
      scenarioTypeId: s.isPrimary ? null : s.scenarioTypeId,
      isPrimary: s.isPrimary,
      entry: parsePrice(s.entry),
      stop: parsePrice(s.stop),
      target: parsePrice(s.target),
      exitPrice: s.exitReason === "not_filled" ? null : parsePrice(s.exitPrice),
      exitReason: (s.exitReason || (parsePrice(s.exitPrice) == null ? null : "manual")) as string | null,
      notes: s.notes,
    }));
    const bad = parsed.findIndex((s, i) => {
      const raw = scenarios[i];
      return (
        s.entry == null ||
        s.stop == null ||
        (raw.target.trim() !== "" && s.target == null) ||
        (raw.exitPrice.trim() !== "" && s.exitPrice == null && s.exitReason !== "not_filled")
      );
    });
    if (bad >= 0) {
      const who = scenarios[bad].isPrimary ? "Primary scenario" : `Alternative #${bad}`;
      setError(`${who}: entry and stop are required, and every price must be a valid number`);
      return;
    }
    if (isForward && observationOnly && !idea.outcome) {
      setError("Mark the observation as Hit or Miss");
      return;
    }
    const payload = {
      id: idea.id,
      symbol: idea.symbol,
      direction: idea.direction,
      status: idea.status,
      setupId: idea.setupId,
      entryTimeframe: idea.entryTimeframe || null,
      htfBias: idea.htfBias || null,
      regime: idea.regime || null,
      openedAt: idea.openedAt,
      closedAt: idea.closedAt,
      thesis: idea.thesis,
      invalidation: idea.invalidation,
      skipReason: isSkip ? idea.skipReason : "",
      review: idea.review,
      followedPlan: isTaken ? idea.followedPlan : null,
      riskPct: parsePrice(idea.riskPct),
      feesUsd: parsePrice(idea.feesUsd),
      pnlUsd: idea.pnlUsd.trim() === "" ? null : Number(idea.pnlUsd.replace(",", ".")),
      checklistState: idea.checklistState,
      confidence: idea.confidence,
      outcome: isForward ? idea.outcome : null,
      tagIds: idea.tagIds,
      scenarios: parsed,
      attachments: idea.attachments.map(({ key: _k, ...a }) => a),
      mistakes: idea.mistakes.map((m) => {
        const idx = showScenarios && m.scenarioKey ? scenarios.findIndex((x) => x.key === m.scenarioKey) : -1;
        const cost = m.costR.trim() === "" ? null : Number(m.costR.replace(",", "."));
        return { mistakeTypeId: m.mistakeTypeId, note: m.note, costR: Number.isFinite(cost) ? cost : null, scenarioIndex: idx >= 0 ? idx : null };
      }),
    };
    saving.current = true;
    startTransition(async () => {
      const res = await saveIdea(payload);
      if (!res.ok) {
        saving.current = false;
        setError(res.error);
        return;
      }
      router.push(`/ideas/${res.data!.id}`);
      router.refresh();
    });
  }, [idea, isSkip, isTaken, isForward, observationOnly, showScenarios, pending, uploading, router]);

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

  const tagGroups = useMemo(() => {
    const m = new Map<string, Tag[]>();
    for (const t of tags) m.set(t.group, [...(m.get(t.group) ?? []), t]);
    return [...m.entries()];
  }, [tags]);

  const orderedTypes = useMemo(() => {
    const rank = (t: ScenarioType) => {
      const i = PINNED_TYPES.indexOf(t.name);
      return i === -1 ? PINNED_TYPES.length : i;
    };
    return [...scenarioTypes].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [scenarioTypes]);

  const checklist = setup?.checklist ?? [];
  const checkedCount = checklist.filter((c) => idea.checklistState[c]).length;
  const usedTypeIds = new Set(idea.scenarios.filter((s) => !s.isPrimary).map((s) => s.scenarioTypeId));

  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-5"
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes("Files")) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragOver(false);
        void upload([...e.dataTransfer.files]);
      }}
    >
      {/* ---------- Left column: context ---------- */}
      <div className="space-y-5">
        <Card className="p-4">
          <div className="grid gap-4">
            <Field label="Status">
              <Segmented
                value={idea.status}
                onChange={(v) => set("status", v)}
                options={IDEA_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
                className="flex w-full flex-wrap [&>button]:flex-1"
                size="sm"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Coin" htmlFor="idea-symbol">
                <Input
                  id="idea-symbol"
                  list="symbols"
                  value={idea.symbol}
                  onChange={(e) => set("symbol", e.target.value.toUpperCase())}
                  placeholder="BTC"
                  autoFocus={!idea.id && !idea.symbol}
                />
                <datalist id="symbols">
                  {symbols.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
                {symbols.length > 0 && (
                  <div className="flex flex-wrap gap-1" aria-label="Quick coin">
                    {symbols.slice(0, 8).map((sym) => (
                      <button
                        type="button"
                        key={sym}
                        aria-pressed={idea.symbol === sym}
                        onClick={() => set("symbol", sym)}
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[11px] font-medium",
                          idea.symbol === sym ? "bg-accent/20 text-accent" : "text-faint hover:bg-panel-2 hover:text-fg",
                        )}
                      >
                        {sym}
                      </button>
                    ))}
                  </div>
                )}
              </Field>
              <Field label="Direction">
                <Segmented
                  value={idea.direction}
                  onChange={(v) => set("direction", v)}
                  options={[
                    { value: "long", label: "Long", tone: "bg-emerald-500/15 text-win" },
                    { value: "short", label: "Short", tone: "bg-rose-500/15 text-loss" },
                  ]}
                  className="flex w-full [&>button]:flex-1"
                  size="sm"
                />
              </Field>
            </div>
            <Field label="Setup" htmlFor="idea-setup">
              <Select
                id="idea-setup"
                value={idea.setupId ?? ""}
                onChange={(e) => {
                  const id = e.target.value ? Number(e.target.value) : null;
                  const s = setups.find((x) => x.id === id);
                  setIdea((p) => ({
                    ...p,
                    setupId: id,
                    entryTimeframe: p.entryTimeframe || s?.defaultTimeframe || "",
                    checklistState: {},
                  }));
                }}
              >
                <option value="">— No setup —</option>
                {(["live", "testing", "retired"] as const).map((st) => {
                  const group = setups.filter((s) => s.status === st);
                  if (!group.length) return null;
                  return (
                    <optgroup key={st} label={st === "live" ? "Live" : st === "testing" ? "Testing" : "Retired"}>
                      {group.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <DateTimeField
                id="idea-opened"
                label="Opened (UTC)"
                value={isoToZonedInput(idea.openedAt)}
                onChange={(v) => {
                  const iso = zonedInputToIso(v);
                  if (iso) set("openedAt", iso);
                }}
                onNow={() => set("openedAt", new Date().toISOString())}
              />
              <DateTimeField
                id="idea-closed"
                label="Closed (UTC)"
                value={isoToZonedInput(idea.closedAt)}
                onChange={(v) => set("closedAt", v ? zonedInputToIso(v) : null)}
                onNow={() => set("closedAt", new Date().toISOString())}
                onClear={idea.closedAt ? () => set("closedAt", null) : undefined}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Entry TF" htmlFor="idea-tf">
                <Select id="idea-tf" value={idea.entryTimeframe} onChange={(e) => set("entryTimeframe", e.target.value)}>
                  <option value="">—</option>
                  {TIMEFRAMES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="HTF bias" htmlFor="idea-bias">
                <Select id="idea-bias" value={idea.htfBias} onChange={(e) => set("htfBias", e.target.value)}>
                  <option value="">—</option>
                  {BIASES.map((b) => (
                    <option key={b} value={b}>
                      {BIAS_LABEL[b]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Market" htmlFor="idea-regime">
                <Select id="idea-regime" value={idea.regime} onChange={(e) => set("regime", e.target.value)}>
                  <option value="">—</option>
                  {REGIMES.map((r) => (
                    <option key={r} value={r}>
                      {REGIME_LABEL[r]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>
        </Card>

        {checklist.length > 0 && (
          <Card>
            <CardHeader
              title="Setup checklist"
              description={setup?.name}
              action={
                <Badge className={checkedCount === checklist.length ? "text-win" : undefined}>
                  {checkedCount}/{checklist.length}
                </Badge>
              }
            />
            <div className="space-y-1 px-4 pb-4">
              {checklist.map((item) => {
                const on = !!idea.checklistState[item];
                return (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    key={item}
                    onClick={() => set("checklistState", { ...idea.checklistState, [item]: !on })}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-panel-2"
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                        on ? "border-win bg-win/20 text-win" : "border-line-strong",
                      )}
                    >
                      {on && <Check className="h-3 w-3" />}
                    </span>
                    <span className={on ? "text-fg" : "text-muted"}>{item}</span>
                  </button>
                );
              })}
            </div>
          </Card>
        )}

        <Card>
          <CardHeader title="Tags" description="Context, level, candle, mistakes, skip reasons — anything you want to slice stats by." />
          <div className="space-y-3 px-4 pb-4">
            {tagGroups.map(([group, list]) => (
              <div key={group}>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-faint">{group}</p>
                <div className="flex flex-wrap gap-1.5">
                  {list.map((t) => {
                    const on = idea.tagIds.includes(t.id);
                    return (
                      <button
                        type="button"
                        key={t.id}
                        aria-pressed={on}
                        onClick={() => set("tagIds", on ? idea.tagIds.filter((x) => x !== t.id) : [...idea.tagIds, t.id])}
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
      </div>

      {/* ---------- Right column: scenarios, notes, screenshots ---------- */}
      <div className="space-y-5">
        <Card>
          <CardHeader
            title={isForward && observationOnly ? "Observation" : "Scenarios"}
            description={
              isForward && observationOnly
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
            {showScenarios && (
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
                    onChange={(patch) => updateScenario(s.key, patch)}
                    onRemove={
                      s.isPrimary
                        ? undefined
                        : () =>
                            setIdea((p) => ({
                              ...p,
                              scenarios: p.scenarios.filter((x) => x.key !== s.key),
                              mistakes: p.mistakes.map((m) => (m.scenarioKey === s.key ? { ...m, scenarioKey: null } : m)),
                            }))
                    }
                  />
                ))}
                <TypePicker
                  label="Add an alternative scenario"
                  hint="Same trade, different entry / stop / exit — e.g. “what if I'd moved the stop to BE”. It starts as a copy of the primary."
                  types={orderedTypes}
                  quick={orderedTypes.slice(0, 4).map((t) => t.id)}
                  usedIds={usedTypeIds as Set<number>}
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
              {isTaken && (
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
                        idea.confidence != null && n <= idea.confidence
                          ? "border-accent/60 bg-accent/15 text-accent"
                          : "border-line text-faint hover:text-fg",
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

        <Card>
          <CardHeader
            title="Mistakes"
            description="What went wrong? Link a mistake to an alternative to measure what it cost you."
            action={idea.mistakes.length ? <Badge className="border-rose-500/30 bg-rose-500/10 text-loss">{idea.mistakes.length}</Badge> : undefined}
          />
          <div className="space-y-2.5 px-4 pb-4">
            {idea.mistakes.map((m) => {
              const type = mistakeTypes.find((t) => t.id === m.mistakeTypeId);
              const alternatives = idea.scenarios.filter((x) => !x.isPrimary);
              const linked = alternatives.find((x) => x.key === m.scenarioKey);
              const manual = m.costR.trim() === "" ? null : Number(m.costR.replace(",", "."));
              const auto = linked ? rDelta(idea.direction, linked, idea.scenarios.find((x) => x.isPrimary)) : null;
              const cost = manual ?? auto;
              return (
                <div key={m.key} className="rounded-lg border border-rose-500/25 bg-rose-500/[0.04] p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-loss">{type?.name ?? "Mistake"}</span>
                    <span className="flex items-center gap-2">
                      {cost != null && Number.isFinite(cost) && (
                        <span className={cn("text-xs font-semibold tabular", cost > 0 ? "text-loss" : "text-win")} title="R lost because of this mistake">
                          {cost > 0 ? `cost ${cost.toFixed(2)}R` : `saved ${Math.abs(cost).toFixed(2)}R`}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => set("mistakes", idea.mistakes.filter((x) => x.key !== m.key))}
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
                      placeholder="R"
                      aria-label="Cost in R"
                      className="h-7 w-16 rounded-md border border-line bg-panel px-1.5 text-xs tabular"
                    />
                    <span className="text-faint">R</span>
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

        <Card className={cn(dragOver && "border-accent ring-2 ring-accent/30")}>
          <CardHeader
            title="Screenshots"
            description="Paste (⌘V), drag & drop, or browse. Before / during / after."
            action={
              <Button size="sm" onClick={() => fileInput.current?.click()}>
                <ImagePlus className="h-3.5 w-3.5" /> Add
              </Button>
            }
          />
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            className="hidden"
            onChange={(e) => {
              void upload([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          <div className="grid grid-cols-3 gap-3 px-4 pb-4">
            {idea.attachments.map((a) => (
              <div key={a.key} className="overflow-hidden rounded-lg border border-line bg-panel-2">
                <div className="relative aspect-video bg-black/40">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/uploads/${a.filePath}`} alt={a.caption || "Screenshot"} className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => set("attachments", idea.attachments.filter((x) => x.key !== a.key))}
                    className="absolute top-1 right-1 rounded-md bg-black/70 p-1 text-white hover:bg-rose-600"
                    aria-label="Remove screenshot"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="space-y-1.5 p-2">
                  <select
                    value={a.kind}
                    aria-label="When was this screenshot taken"
                    onChange={(e) =>
                      set(
                        "attachments",
                        idea.attachments.map((x) => (x.key === a.key ? { ...x, kind: e.target.value as EditorAttachment["kind"] } : x)),
                      )
                    }
                    className="w-full rounded border border-line bg-panel px-1.5 py-1 text-xs"
                  >
                    <option value="before">Before</option>
                    <option value="during">During</option>
                    <option value="after">After</option>
                  </select>
                  <input
                    value={a.caption}
                    placeholder="Caption"
                    aria-label="Caption"
                    onChange={(e) =>
                      set("attachments", idea.attachments.map((x) => (x.key === a.key ? { ...x, caption: e.target.value } : x)))
                    }
                    className="w-full rounded border border-line bg-panel px-1.5 py-1 text-xs"
                  />
                </div>
              </div>
            ))}
            {uploading > 0 && (
              <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-line text-xs text-muted">
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Uploading…
              </div>
            )}
            {!idea.attachments.length && !uploading && (
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="col-span-full flex h-24 items-center justify-center rounded-lg border border-dashed border-line text-sm text-faint hover:border-line-strong hover:text-muted"
              >
                Paste a chart screenshot here
              </button>
            )}
          </div>
        </Card>

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
                router.back();
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

function DateTimeField({
  id,
  label,
  value,
  onChange,
  onNow,
  onClear,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onNow: () => void;
  onClear?: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="truncate text-xs font-medium text-muted">
          {label}
        </label>
        <span className="flex shrink-0 gap-2 text-[11px]">
          {onClear && (
            <button type="button" onClick={onClear} className="text-faint hover:text-fg">
              Clear
            </button>
          )}
          <button type="button" onClick={onNow} className="text-accent hover:underline">
            Now
          </button>
        </span>
      </div>
      <Input id={id} type="datetime-local" value={value} onChange={(e) => onChange(e.target.value)} className="min-w-0 px-2" />
    </div>
  );
}

function ScenarioCard({
  s,
  index,
  dir,
  status,
  minRR,
  beThreshold,
  scenarioTypes,
  onChange,
  onRemove,
}: {
  s: EditorScenario;
  index: number;
  dir: Dir;
  status: string;
  minRR: number;
  beThreshold: number;
  scenarioTypes: ScenarioType[];
  onChange: (patch: Partial<EditorScenario>) => void;
  onRemove?: () => void;
}) {
  const entry = parsePrice(s.entry);
  const stop = parsePrice(s.stop);
  const target = parsePrice(s.target);
  const exit = parsePrice(s.exitPrice);
  const notFilled = s.exitReason === "not_filled";
  const valid = entry != null && stop != null;
  const badStop = valid && !stopIsValid(dir, entry!, stop!);
  const rr = valid && !badStop ? plannedRR(dir, entry!, stop!, target) : null;
  const r = valid && !badStop ? scenarioR(dir, { entry: entry!, stop: stop!, exitPrice: exit, exitReason: s.exitReason || null }) : null;
  const riskPct = valid && entry ? (Math.abs(entry - stop!) / entry) * 100 : null;
  const tone = rTone(r, beThreshold);
  const typeName = scenarioTypes.find((t) => t.id === s.scenarioTypeId)?.name;

  const title = s.isPrimary ? (status === "taken" || status === "backtest" ? "Actual" : "Plan") : null;

  return (
    <div className={cn("rounded-lg border p-3", s.isPrimary ? "border-accent/40 bg-accent/[0.04]" : "border-line bg-panel-2/50")}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {title ? (
            <span className="text-sm font-semibold text-fg">{title}</span>
          ) : (
            <select
              value={s.scenarioTypeId ?? ""}
              onChange={(e) => onChange({ scenarioTypeId: e.target.value ? Number(e.target.value) : null })}
              className="max-w-44 rounded-md border border-line bg-panel px-2 py-1 text-sm font-medium"
              aria-label={`Alternative ${index} type`}
            >
              <option value="">Untyped alternative</option>
              {scenarioTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          {rr != null && (
            <Badge className={rr < minRR ? "border-amber-500/40 bg-amber-500/10 text-warn" : undefined} title="Planned reward:risk to target">
              <Target className="h-3 w-3" /> {rr.toFixed(2)} R:R
            </Badge>
          )}
          {riskPct != null && !badStop && <span className="text-[11px] whitespace-nowrap text-faint tabular">stop {riskPct.toFixed(2)}%</span>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={cn(
              "tabular whitespace-nowrap text-base font-semibold",
              notFilled ? "text-faint" : tone === "win" ? "text-win" : tone === "loss" ? "text-loss" : tone === "be" ? "text-be" : "text-faint",
            )}
          >
            {notFilled ? "not filled · 0R" : r == null ? "open" : fmtR(r)}
          </span>
          {onRemove && (
            <button type="button" onClick={onRemove} className="rounded p-1 text-faint hover:bg-panel-3 hover:text-loss" aria-label="Remove alternative">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <PriceInput label="Entry" value={s.entry} onChange={(v) => onChange({ entry: v })} />
        <PriceInput label={s.isPrimary ? "Stop" : "Stop (initial)"} value={s.stop} onChange={(v) => onChange({ stop: v })} invalid={badStop} />
        <PriceInput label="Target (FTA)" value={s.target} onChange={(v) => onChange({ target: v })} />
        <PriceInput
          label="Exit"
          value={notFilled ? "" : s.exitPrice}
          disabled={notFilled}
          onChange={(v) => onChange({ exitPrice: v, exitReason: s.exitReason === "not_filled" ? "" : s.exitReason })}
        />
      </div>
      {badStop && (
        <p className="mt-1.5 text-xs text-loss">
          {entry === stop
            ? "Stop can't equal entry — it defines 1R. Keep the initial stop and use the Breakeven exit."
            : `Stop must be ${dir === "long" ? "below" : "above"} entry for a ${dir}.`}
        </p>
      )}
      {!s.isPrimary && typeName === "BE stop" && !badStop && (
        <p className="mt-1.5 text-[11px] text-faint">Keep the initial stop — if price came back to entry, click Breakeven.</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <QuickExit disabled={target == null} onClick={() => onChange({ exitPrice: s.target, exitReason: "target" })}>
          Hit target
        </QuickExit>
        <QuickExit disabled={stop == null} onClick={() => onChange({ exitPrice: s.stop, exitReason: "stop" })}>
          Stopped
        </QuickExit>
        <QuickExit disabled={entry == null} onClick={() => onChange({ exitPrice: s.entry, exitReason: "be" })}>
          Breakeven
        </QuickExit>
        {(!s.isPrimary || status !== "taken") && (
          <QuickExit onClick={() => onChange({ exitPrice: "", exitReason: "not_filled" })}>Not filled</QuickExit>
        )}
        <QuickExit onClick={() => onChange({ exitPrice: "", exitReason: "" })}>Still open</QuickExit>
        <select
          value={s.exitReason}
          onChange={(e) => onChange({ exitReason: e.target.value })}
          className="ml-auto rounded-md border border-line bg-panel px-2 py-1 text-xs text-muted"
          aria-label="Exit reason"
        >
          <option value="">Exit reason…</option>
          {EXIT_REASONS.map((x) => (
            <option key={x} value={x}>
              {EXIT_LABEL[x]}
            </option>
          ))}
        </select>
      </div>
      <input
        value={s.notes}
        onChange={(e) => onChange({ notes: e.target.value })}
        placeholder={s.isPrimary ? "Notes on execution…" : "What's different here and why?"}
        aria-label="Scenario notes"
        className="mt-2 w-full rounded-md border border-line bg-panel px-2 py-1.5 text-xs placeholder:text-faint"
      />
    </div>
  );
}

function PriceInput({
  label,
  value,
  onChange,
  invalid,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const parsed = parsePrice(value);
  const unparseable = value.trim() !== "" && parsed == null;
  // Echo the interpreted number when the user typed separators, so "64,250" is visibly 64250.
  const echo = parsed != null && /[,\s]/.test(value) ? parsed.toLocaleString("en-US", { maximumFractionDigits: 10 }) : null;
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-faint">{label}</span>
      <input
        inputMode="decimal"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.,\s]/g, ""))}
        className={cn(
          "h-8 w-full rounded-md border bg-panel px-2 text-sm tabular focus:outline-none focus:ring-2 disabled:opacity-40",
          invalid || unparseable ? "border-rose-500/60 focus:ring-rose-500/30" : "border-line focus:border-accent/70 focus:ring-accent/20",
        )}
      />
      {unparseable ? <span className="text-[10px] text-loss">Not a number</span> : echo ? <span className="text-[10px] text-faint">= {echo}</span> : null}
    </label>
  );
}

function QuickExit({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-md border border-line px-2 py-1 text-xs text-muted hover:border-line-strong hover:text-fg disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** Cost of a mistake linked to `alt` (shared rule: `mistakeCost` in stats.ts), from the editor's string fields. */
function rDelta(dir: Dir, alt: EditorScenario, primary: EditorScenario | undefined): number | null {
  const prices = (x: EditorScenario) => {
    const entry = parsePrice(x.entry);
    const stop = parsePrice(x.stop);
    return entry == null || stop == null ? null : { entry, stop, exitPrice: parsePrice(x.exitPrice), exitReason: x.exitReason || null };
  };
  return mistakeCost(dir, prices(alt), primary && prices(primary));
}
