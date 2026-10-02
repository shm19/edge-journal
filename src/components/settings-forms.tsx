"use client";

import { Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { MistakeType, ScenarioType, Tag } from "@/db/schema";
import {
  deleteMistakeType,
  deleteScenarioType,
  deleteTag,
  deleteTagGroup,
  renameTagGroup,
  saveMistakeType,
  saveScenarioType,
  saveSettings,
  saveTag,
} from "@/lib/actions";
import { Badge, Button, Card, CardHeader, Field, Input, Select } from "./ui";

export function GeneralSettings({
  initial,
}: {
  initial: { beThresholdR: number; minRR: number; defaultRiskPct: number; symbols: string[] };
}) {
  const router = useRouter();
  const [f, setF] = useState({
    beThresholdR: String(initial.beThresholdR),
    minRR: String(initial.minRR),
    defaultRiskPct: String(initial.defaultRiskPct),
    symbols: initial.symbols.join(", "),
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const numbers = { beThresholdR: f.beThresholdR, minRR: f.minRR, defaultRiskPct: f.defaultRiskPct };
      const empty = Object.entries(numbers).find(([, v]) => v.trim() === "" || !Number.isFinite(Number(v.replace(",", "."))));
      if (empty) {
        setMsg({ ok: false, text: "Enter a number in every numeric field" });
        return;
      }
      const res = await saveSettings({
        beThresholdR: Number(f.beThresholdR.replace(",", ".")),
        minRR: Number(f.minRR.replace(",", ".")),
        defaultRiskPct: Number(f.defaultRiskPct.replace(",", ".")),
        symbols: f.symbols
          .split(/[,\s]+/)
          .map((s) => s.trim())
          .filter(Boolean),
      });
      setMsg(res.ok ? { ok: true, text: "Saved" } : { ok: false, text: res.error });
      if (res.ok) router.refresh();
    });

  return (
    <Card>
      <CardHeader title="General" />
      <div className="grid gap-4 px-4 pb-4 sm:grid-cols-2">
        <Field label="Breakeven band (±R)" hint="Results within this band count as BE, not win/loss.">
          <Input inputMode="decimal" value={f.beThresholdR} onChange={(e) => setF({ ...f, beThresholdR: e.target.value })} />
        </Field>
        <Field label="Minimum R:R" hint="Planned R:R below this is flagged amber.">
          <Input inputMode="decimal" value={f.minRR} onChange={(e) => setF({ ...f, minRR: e.target.value })} />
        </Field>
        <Field label="Default risk % per trade">
          <Input inputMode="decimal" value={f.defaultRiskPct} onChange={(e) => setF({ ...f, defaultRiskPct: e.target.value })} />
        </Field>
        <Field label="Timezone" hint="Fixed: every time is entered and shown in UTC.">
          <Input value="UTC" disabled readOnly aria-readonly />
        </Field>
        <Field label="Coins you trade" hint="Comma separated — used for suggestions." className="sm:col-span-2">
          <Input value={f.symbols} onChange={(e) => setF({ ...f, symbols: e.target.value.toUpperCase() })} />
        </Field>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button variant="primary" onClick={submit} disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save settings
          </Button>
          {msg && <span className={msg.ok ? "text-sm text-win" : "text-sm text-loss"}>{msg.text}</span>}
        </div>
      </div>
    </Card>
  );
}

const TAG_COLORS = ["#6366f1", "#0ea5e9", "#f59e0b", "#22c55e", "#ef4444", "#ec4899", "#8b5cf6", "#14b8a6", "#64748b"];

type TagDraft = { id?: number; name: string; group: string; color: string };
const NEW_GROUP = "__new__";

export function TagManager({ tags, usage }: { tags: Tag[]; usage: Record<number, number> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<TagDraft | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);
  const groups = [...new Set(tags.map((t) => t.group))].sort();
  const groupColor = (g: string) => tags.find((t) => t.group === g)?.color ?? TAG_COLORS[0];

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return setError(res.error ?? "Something went wrong");
      setError(null);
      after?.();
      router.refresh();
    });

  const startNew = (group?: string) => {
    setError(null);
    setNewGroupName("");
    const g = group ?? groups[0] ?? NEW_GROUP;
    setEditing({ name: "", group: g, color: group ? groupColor(group) : TAG_COLORS[0] });
  };

  const save = () => {
    if (!editing) return;
    const group = editing.group === NEW_GROUP ? newGroupName.trim() : editing.group;
    if (!group) return setError("Name the new group");
    run(() => saveTag({ ...editing, group }), () => setEditing(null));
  };

  const editor = editing && (
    <div className="mx-4 mb-3 grid gap-3 rounded-lg border border-accent/40 bg-accent/[0.04] p-3 sm:grid-cols-2">
      <p className="text-xs font-medium text-muted sm:col-span-2">{editing.id ? "Edit tag" : "New tag"}</p>
      <Field label="Name" htmlFor="tag-name">
        <Input
          id="tag-name"
          value={editing.name}
          onChange={(e) => setEditing({ ...editing, name: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && save()}
          autoFocus
        />
      </Field>
      <Field label="Group" htmlFor="tag-group">
        <Select
          id="tag-group"
          value={editing.group}
          onChange={(e) => {
            const g = e.target.value;
            setEditing({ ...editing, group: g, color: g !== NEW_GROUP && !editing.id ? groupColor(g) : editing.color });
          }}
        >
          {groups.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
          <option value={NEW_GROUP}>+ New group…</option>
        </Select>
      </Field>
      {editing.group === NEW_GROUP && (
        <Field label="New group name" htmlFor="tag-new-group" className="sm:col-span-2">
          <Input id="tag-new-group" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="e.g. Session, Exit, Emotion" />
        </Field>
      )}
      <div className="flex flex-wrap items-center gap-1.5 sm:col-span-2">
        <span className="mr-1 text-xs text-faint">Color</span>
        {TAG_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setEditing({ ...editing, color: c })}
            className="h-6 w-6 rounded-full"
            style={{ backgroundColor: c, boxShadow: editing.color === c ? `0 0 0 2px #09090b, 0 0 0 4px ${c}` : undefined }}
            aria-label={`Color ${c}`}
            aria-pressed={editing.color === c}
          />
        ))}
      </div>
      {error && <p className="text-sm text-loss sm:col-span-2">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2">
        {editing.id ? (
          <Button
            variant="danger"
            size="sm"
            disabled={pending}
            onClick={() => {
              const n = usage[editing.id!] ?? 0;
              if (!confirm(`Delete tag “${editing.name}”?${n ? ` It's on ${n} idea(s) and will be removed from them.` : ""}`)) return;
              run(() => deleteTag(editing.id!), () => setEditing(null));
            }}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete tag
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={save} disabled={pending || !editing.name.trim()}>
            <Check className="h-3.5 w-3.5" /> Save
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader
        title="Tags"
        description="Click a tag to rename it, change its color, move it to another group, or delete it. Each group gets its own breakdown in Analytics."
        action={
          <Button size="sm" onClick={() => startNew()}>
            <Plus className="h-3.5 w-3.5" /> Tag
          </Button>
        }
      />
      {editing && !editing.id && editor}
      {error && !editing && <p className="mx-4 mb-3 text-sm text-loss">{error}</p>}
      <div className="space-y-4 px-4 pb-4">
        {groups.map((g) => {
          const inGroup = tags.filter((t) => t.group === g);
          const used = inGroup.reduce((n, t) => n + (usage[t.id] ?? 0), 0);
          return (
            <div key={g}>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                {renaming?.from === g ? (
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={renaming.to}
                      onChange={(e) => setRenaming({ from: g, to: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") run(() => renameTagGroup(g, renaming.to), () => setRenaming(null));
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      className="h-7 w-44 text-xs"
                      autoFocus
                      aria-label={`Rename group ${g}`}
                    />
                    <Button size="icon" variant="ghost" onClick={() => run(() => renameTagGroup(g, renaming.to), () => setRenaming(null))} aria-label="Save group name">
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => setRenaming(null)} aria-label="Cancel rename">
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <p className="text-[11px] font-medium uppercase tracking-wider text-faint">
                    {g} <span className="normal-case tracking-normal">· {inGroup.length}</span>
                  </p>
                )}
                {renaming?.from !== g && (
                  <div className="flex items-center gap-0.5">
                    <Button size="sm" variant="ghost" onClick={() => startNew(g)} aria-label={`Add tag to ${g}`}>
                      <Plus className="h-3.5 w-3.5" /> Add
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => setRenaming({ from: g, to: g })} aria-label={`Rename group ${g}`} title="Rename group">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Delete group"
                      aria-label={`Delete group ${g}`}
                      onClick={() => {
                        if (!confirm(`Delete the “${g}” group and its ${inGroup.length} tag(s)?${used ? ` They're used ${used} time(s) and will be removed from those ideas.` : ""}`)) return;
                        run(() => deleteTagGroup(g));
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {inGroup.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setError(null);
                      setEditing({ id: t.id, name: t.name, group: t.group, color: t.color });
                    }}
                    className="rounded-md transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                    aria-label={`Edit tag ${t.name}`}
                  >
                    <Badge color={t.color} className={editing?.id === t.id ? "ring-2 ring-accent/60" : undefined}>
                      {t.name}
                      <span className="opacity-60">{usage[t.id] ? ` · ${usage[t.id]}` : ""}</span>
                    </Badge>
                  </button>
                ))}
              </div>
              {editing?.id && editing && inGroup.some((t) => t.id === editing.id) && <div className="-mx-4 mt-3">{editor}</div>}
            </div>
          );
        })}
        {!groups.length && <p className="text-sm text-faint">No tags yet.</p>}
      </div>
    </Card>
  );
}

const TYPE_KINDS = {
  scenario: {
    title: "Alternative scenario types",
    description: "Reusable “what if” variants (BE stop, wick entry, …) you can attach to any idea and compare in Analytics.",
    save: saveScenarioType,
    remove: deleteScenarioType,
    usedLabel: "alternative scenario(s)",
  },
  mistake: {
    title: "Mistake types",
    description: "The mistakes you record on trades. Each is tracked for frequency and R cost.",
    save: saveMistakeType,
    remove: deleteMistakeType,
    usedLabel: "recorded mistake(s)",
  },
} as const;

export function ScenarioTypeManager(props: { types: ScenarioType[]; usage: Record<number, number> }) {
  return <TypeManager kind="scenario" {...props} />;
}

export function MistakeTypeManager(props: { types: MistakeType[]; usage: Record<number, number> }) {
  return <TypeManager kind="mistake" {...props} />;
}

function TypeManager({
  kind,
  types,
  usage,
}: {
  kind: keyof typeof TYPE_KINDS;
  types: { id: number; name: string; description: string }[];
  usage: Record<number, number>;
}) {
  const cfg = TYPE_KINDS[kind];
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id?: number; name: string; description: string } | null>(null);

  const save = () =>
    start(async () => {
      if (!editing) return;
      const res = await cfg.save(editing);
      if (!res.ok) return setError(res.error);
      setError(null);
      setEditing(null);
      router.refresh();
    });

  return (
    <Card>
      <CardHeader
        title={cfg.title}
        description={cfg.description}
        action={
          <Button size="sm" onClick={() => setEditing({ name: "", description: "" })}>
            <Plus className="h-3.5 w-3.5" /> Type
          </Button>
        }
      />
      {editing && (
        <div className="mx-4 mb-3 grid gap-3 rounded-lg border border-accent/40 bg-accent/[0.04] p-3 sm:grid-cols-[1fr_2fr_auto]">
          <Field label="Name">
            <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />
          </Field>
          <Field label="Description">
            <Input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
          </Field>
          <div className="flex items-end gap-2">
            <Button variant="primary" onClick={save} disabled={pending || !editing.name.trim()}>
              <Check className="h-4 w-4" />
            </Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          {error && <p className="text-sm text-loss sm:col-span-3">{error}</p>}
        </div>
      )}
      <ul className="divide-y divide-line px-4 pb-2">
        {types.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <div className="min-w-0">
              <p className="font-medium">
                {t.name} {usage[t.id] ? <span className="text-xs font-normal text-faint">· used {usage[t.id]}×</span> : null}
              </p>
              <p className="text-xs break-words text-faint">{t.description}</p>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button size="icon" variant="ghost" onClick={() => setEditing({ id: t.id, name: t.name, description: t.description })} aria-label="Edit">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Delete"
                onClick={() => {
                  if (!confirm(`Delete “${t.name}”?${usage[t.id] ? ` Its ${usage[t.id]} ${cfg.usedLabel} will be removed too.` : ""}`)) return;
                  start(async () => {
                    await cfg.remove(t.id);
                    router.refresh();
                  });
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
