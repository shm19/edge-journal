"use client";

import { Loader2, Plus, Settings2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { Button, Input } from "./ui";

export interface PickableType {
  id: number;
  name: string;
  description: string;
}

/**
 * "Use a saved type or create a new one" block, shared by alternatives and mistakes.
 * Quick chips for the most relevant types, a dropdown with all of them, and an inline "create" form.
 */
export function TypePicker({
  label,
  hint,
  types,
  quick,
  usedIds,
  onPick,
  onCreate,
  createPlaceholder,
  tone = "accent",
}: {
  label: string;
  hint?: string;
  types: PickableType[];
  /** Ids shown as one-tap chips (in this order). */
  quick: number[];
  usedIds?: Set<number>;
  onPick: (id: number) => void;
  onCreate: (name: string, description: string) => Promise<{ ok: true; id: number } | { ok: false; error: string }>;
  createPlaceholder: string;
  tone?: "accent" | "loss";
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const byId = new Map(types.map((t) => [t.id, t]));
  const hover = tone === "loss" ? "hover:border-rose-400/70 hover:text-loss" : "hover:border-accent hover:text-fg";

  const create = async () => {
    const n = name.trim();
    if (!n) return;
    const existing = types.find((t) => t.name.toLowerCase() === n.toLowerCase());
    if (existing) {
      onPick(existing.id);
      reset();
      return;
    }
    setBusy(true);
    const res = await onCreate(n, description.trim());
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onPick(res.id);
    reset();
  };
  const reset = () => {
    setCreating(false);
    setName("");
    setDescription("");
    setError(null);
  };

  return (
    <div className="rounded-lg border border-dashed border-line-strong p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-fg">{label}</p>
          {hint && <p className="text-[11px] text-faint">{hint}</p>}
        </div>
        <Link href="/settings" className="inline-flex shrink-0 items-center gap-1 text-[11px] text-faint hover:text-fg" title="Manage saved types in Settings">
          <Settings2 className="h-3 w-3" /> Manage
        </Link>
      </div>

      {quick.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {quick.map((id) => {
            const t = byId.get(id);
            if (!t) return null;
            return (
              <button
                type="button"
                key={id}
                title={t.description}
                aria-label={`Add ${t.name}`}
                onClick={() => onPick(id)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors",
                  usedIds?.has(id) ? "border-line text-faint" : `border-line-strong text-muted ${hover}`,
                )}
              >
                <Plus className="h-3 w-3" /> {t.name}
              </button>
            );
          })}
        </div>
      )}

      {!creating ? (
        <div className="flex flex-wrap gap-2">
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) onPick(Number(e.target.value));
            }}
            className="h-8 min-w-0 flex-1 rounded-md border border-line bg-panel px-2 text-xs text-muted"
            aria-label={`${label}: choose a saved type`}
          >
            <option value="">All saved types…</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.description ? ` — ${t.description.slice(0, 60)}` : ""}
              </option>
            ))}
          </select>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" /> New type
          </Button>
        </div>
      ) : (
        <div className="space-y-2 rounded-md border border-line bg-panel p-2.5">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium text-muted">New type — saved for future trades too</p>
            <button type="button" onClick={reset} className="text-faint hover:text-fg" aria-label="Cancel new type">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void create();
              }
            }}
            placeholder={createPlaceholder}
            aria-label="New type name"
            autoFocus
            className="h-8 text-xs"
          />
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short description (optional)"
            aria-label="New type description"
            className="h-8 text-xs"
          />
          {error && <p className="text-xs text-loss">{error}</p>}
          <div className="flex justify-end">
            <Button size="sm" variant="primary" onClick={() => void create()} disabled={busy || !name.trim()}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Create & add
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
