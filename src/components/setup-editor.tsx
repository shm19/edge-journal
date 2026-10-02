"use client";

import { ArrowDown, ArrowUp, Check, Loader2, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { SETUP_STATUSES, TIMEFRAMES } from "@/db/schema";
import { deleteSetup, saveSetup } from "@/lib/actions";
import { Button, Card, Field, Input, Segmented, Select, Textarea } from "./ui";

export interface SetupForm {
  id?: number;
  name: string;
  description: string;
  rules: string;
  checklist: string[];
  status: (typeof SETUP_STATUSES)[number];
  defaultTimeframe: string;
  color: string;
}

const COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ec4899", "#14b8a6", "#8b5cf6", "#ef4444", "#0ea5e9", "#a3e635", "#f97316"];

export function SetupEditor({ initial, tradeCount = 0 }: { initial: SetupForm; tradeCount?: number }) {
  const router = useRouter();
  const [f, setF] = useState(initial);
  const [newItem, setNewItem] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof SetupForm>(k: K, v: SetupForm[K]) => setF((p) => ({ ...p, [k]: v }));

  const addItem = () => {
    const v = newItem.trim();
    if (!v || f.checklist.includes(v)) return;
    set("checklist", [...f.checklist, v]);
    setNewItem("");
  };
  const move = (i: number, d: number) => {
    const list = [...f.checklist];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    set("checklist", list);
  };

  const submit = () =>
    start(async () => {
      setError(null);
      const res = await saveSetup({ ...f, defaultTimeframe: f.defaultTimeframe || null });
      if (!res.ok) return setError(res.error);
      router.push(`/setups/${res.data!.id}`);
      router.refresh();
    });

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5">
      <Card className="space-y-4 p-4">
        <Field label="Name">
          <Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. LHPB retest" autoFocus={!f.id} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Status" hint="Testing = still collecting data. Retired = no longer traded.">
            <Segmented
              value={f.status}
              onChange={(v) => set("status", v)}
              options={SETUP_STATUSES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))}
              size="sm"
            />
          </Field>
          <Field label="Default entry timeframe">
            <Select value={f.defaultTimeframe} onChange={(e) => set("defaultTimeframe", e.target.value)}>
              <option value="">—</option>
              {TIMEFRAMES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Color">
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => set("color", c)}
                className="flex h-7 w-7 items-center justify-center rounded-full ring-offset-2 ring-offset-panel"
                style={{ backgroundColor: c, boxShadow: f.color === c ? `0 0 0 2px ${c}` : undefined }}
                aria-label={c}
              >
                {f.color === c && <Check className="h-4 w-4 text-white" />}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Idea in one line">
          <Textarea value={f.description} onChange={(e) => set("description", e.target.value)} className="min-h-16" />
        </Field>
        <Field label="Rules" hint="Markdown. Entry, stop, target, management, when to stand aside.">
          <Textarea value={f.rules} onChange={(e) => set("rules", e.target.value)} className="min-h-48 font-mono text-[13px]" />
        </Field>
      </Card>

      <div className="space-y-5">
        <Card className="p-4">
          <p className="mb-1 text-sm font-semibold">Pre-trade checklist</p>
          <p className="mb-3 text-xs text-faint">Shown in the idea editor when this setup is picked.</p>
          <ul className="space-y-1.5">
            {f.checklist.map((item, i) => (
              <li key={item} className="flex items-center gap-2 rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 text-sm">
                <span className="flex-1">{item}</span>
                <button type="button" onClick={() => move(i, -1)} className="p-1 text-faint hover:text-fg" aria-label="Move up">
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => move(i, 1)} className="p-1 text-faint hover:text-fg" aria-label="Move down">
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => set("checklist", f.checklist.filter((x) => x !== item))}
                  className="p-1 text-faint hover:text-loss"
                  aria-label="Remove"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <Input
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addItem();
                }
              }}
              placeholder="Add a check, press Enter"
            />
            <Button onClick={addItem} size="md">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </Card>

        <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-panel px-4 py-3">
          {f.id ? (
            <Button
              variant="danger"
              size="sm"
              disabled={pending}
              onClick={() => {
                const msg = tradeCount
                  ? `Delete this setup? ${tradeCount} idea(s) use it and will become "No setup".`
                  : "Delete this setup?";
                if (!confirm(msg)) return;
                start(async () => {
                  await deleteSetup(f.id!);
                  router.push("/setups");
                });
              }}
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            {error && <span className="text-sm text-loss">{error}</span>}
            <Button variant="ghost" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} disabled={pending || !f.name.trim()}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
