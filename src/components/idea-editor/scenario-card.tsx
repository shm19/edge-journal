import { Target, Trash2 } from "lucide-react";
import type { ScenarioType } from "@/db/schema";
import { EXIT_REASONS } from "@/db/schema";
import { cn } from "@/lib/cn";
import { priceFieldId, type EditorScenario, type PriceField } from "@/lib/editor-shape";
import { EXIT_LABEL, fmtR, rTone } from "@/lib/format";
import { parsePrice } from "@/lib/price";
import { plannedRR, scenarioR, stopIsValid, type Dir } from "@/lib/stats";
import { Badge, Select } from "../ui";

export function ScenarioCard({
  s,
  index,
  dir,
  status,
  minRR,
  beThreshold,
  scenarioTypes,
  onChange,
  onRemove,
  fieldError,
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
  /** The field a failed save points at (its DOM id) and the message to show under it. */
  fieldError?: { id: string; message: string } | null;
}) {
  const who = s.isPrimary ? "Primary" : `Alternative ${index}`;
  const price = (field: PriceField) => ({
    id: priceFieldId(s.key, field),
    ariaLabel: `${who} ${field} price`,
    error: fieldError?.id === priceFieldId(s.key, field) ? fieldError.message : undefined,
  });
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
            <Select
              value={s.scenarioTypeId ?? ""}
              onChange={(e) => onChange({ scenarioTypeId: e.target.value ? Number(e.target.value) : null })}
              size="sm" className="w-auto max-w-44 font-medium"
              aria-label={`Alternative ${index} type`}
            >
              <option value="">Untyped alternative</option>
              {scenarioTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
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
        <PriceInput label="Entry" {...price("entry")} value={s.entry} onChange={(v) => onChange({ entry: v })} />
        <PriceInput label={s.isPrimary ? "Stop" : "Stop (initial)"} {...price("stop")} value={s.stop} onChange={(v) => onChange({ stop: v })} invalid={badStop} />
        <PriceInput label="Target (FTA)" {...price("target")} value={s.target} onChange={(v) => onChange({ target: v })} />
        <PriceInput
          label="Exit"
          {...price("exit")}
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
        <Select
          value={s.exitReason}
          onChange={(e) => onChange({ exitReason: e.target.value })}
          size="sm" className="ml-auto w-auto"
          aria-label="Exit reason"
        >
          <option value="">Exit reason…</option>
          {EXIT_REASONS.map((x) => (
            <option key={x} value={x}>
              {EXIT_LABEL[x]}
            </option>
          ))}
        </Select>
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
  id,
  ariaLabel,
  error,
  value,
  onChange,
  invalid,
  disabled,
}: {
  label: string;
  id: string;
  /** Accessible name that says which scenario the box belongs to ("Primary entry price"). */
  ariaLabel: string;
  /** Message from a failed save. */
  error?: string;
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
        id={id}
        aria-label={ariaLabel}
        inputMode="decimal"
        value={value}
        disabled={disabled}
        aria-invalid={invalid || unparseable || !!error || undefined}
        // Not filtered: a typo must stay visible ("Not a number") instead of silently turning into an empty box.
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "h-8 w-full rounded-md border bg-panel px-2 text-sm tabular focus:outline-none focus:ring-2 disabled:opacity-40",
          invalid || unparseable || error ? "border-rose-500/60 focus:ring-rose-500/30" : "border-line focus:border-accent/70 focus:ring-accent/20",
        )}
      />
      {unparseable ? (
        <span className="text-[10px] text-loss">Not a number</span>
      ) : error && error.length < 40 ? (
        <span className="text-[10px] text-loss">{error}</span>
      ) : echo ? <span className="text-[10px] text-faint">= {echo}</span> : null}
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
