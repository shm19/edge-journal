import type { Dispatch, SetStateAction } from "react";
import type { Setup } from "@/db/schema";
import { BIASES, IDEA_STATUSES, REGIMES, TIMEFRAMES } from "@/db/schema";
import { cn } from "@/lib/cn";
import { setClosedAt, setOpenedAt, setStatus, type EditorIdea } from "@/lib/editor-shape";
import { BIAS_LABEL, REGIME_LABEL, STATUS_LABEL } from "@/lib/format";
import { isoToZonedInput, zonedInputToIso } from "@/lib/tz";
import { Card, Field, Input, Segmented, Select } from "../ui";
import { DateTimeField } from "./date-time-field";

/** Status, coin, direction, setup, dates and the three context selects. */
export function ContextCard({
  idea,
  setIdea,
  set,
  setups,
  symbols,
}: {
  idea: EditorIdea;
  setIdea: Dispatch<SetStateAction<EditorIdea>>;
  set: <K extends keyof EditorIdea>(k: K, v: EditorIdea[K]) => void;
  setups: Setup[];
  symbols: string[];
}) {
  const changeSetup = (id: number | null) => {
    const ticked = Object.values(idea.checklistState).filter(Boolean).length;
    if (ticked && !confirm(`Changing the setup clears the ${ticked} ticked checklist item${ticked === 1 ? "" : "s"}. Continue?`)) return;
    const s = setups.find((x) => x.id === id);
    setIdea((p) => ({ ...p, setupId: id, entryTimeframe: p.entryTimeframe || s?.defaultTimeframe || "", checklistState: {} }));
  };

  return (
    <Card className="p-4">
      <div className="grid gap-4">
        <Field label="Status">
          <Segmented
            value={idea.status}
            onChange={(v) => setIdea((p) => setStatus(p, v))}
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
          <Select id="idea-setup" value={idea.setupId ?? ""} onChange={(e) => changeSetup(e.target.value ? Number(e.target.value) : null)}>
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
              if (iso) setIdea((p) => setOpenedAt(p, iso));
            }}
            onNow={() => setIdea((p) => setOpenedAt(p, new Date().toISOString()))}
          />
          <DateTimeField
            id="idea-closed"
            label="Closed (UTC)"
            value={isoToZonedInput(idea.closedAt)}
            onChange={(v) => setIdea((p) => setClosedAt(p, v ? zonedInputToIso(v) : null))}
            onNow={() => setIdea((p) => setClosedAt(p, new Date().toISOString()))}
            onClear={idea.closedAt ? () => setIdea((p) => setClosedAt(p, null)) : undefined}
            hint={idea.closedAtAuto ? "Set to the open time — adjust if the trade closed later." : undefined}
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
  );
}
