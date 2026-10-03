"use client";

import * as Popover from "@radix-ui/react-popover";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/cn";
import {
  addDays,
  addMonths,
  displayDateTime,
  longDate,
  monthGrid,
  monthLabel,
  nowInput,
  normalizeRange,
  parseDate,
  parseDateTimeInput,
  parseTime,
  PRESETS,
  presetRange,
  splitDateTime,
  todayUtc,
  weekdayIndex,
  WEEKDAYS,
} from "@/lib/date-input";
import { Button, Input } from "../ui";
import { POPOVER_CHROME } from "./select";

const DATE_FORMAT = "Use YYYY-MM-DD (UTC).";
const DATETIME_FORMAT = "Use YYYY-MM-DD HH:mm (24h, UTC).";
const TIME_FORMAT = "Use 24h HH:mm.";

/**
 * A text draft that follows `value` when it changes from outside (Now, Clear, a picked day, another field
 * dragging it along) but is left alone while it already parses to that value, so typing is never rewritten.
 */
function useDraft(value: string, parse: (s: string) => string | null, show: (v: string) => string = (v) => v) {
  const [draft, setDraft] = React.useState(show(value));
  const [seen, setSeen] = React.useState(value);
  if (value !== seen) {
    setSeen(value);
    if (parse(draft) !== value) setDraft(show(value));
  }
  return [draft, setDraft] as const;
}

/** Move focus to the day button that holds the roving tab stop when a popover opens. */
function focusDay(e: Event) {
  e.preventDefault();
  (e.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-date][tabindex='0']")?.focus();
}

const popoverClass = cn(POPOVER_CHROME, "max-h-(--radix-popover-content-available-height) w-72 overflow-y-auto p-3");

/** Cmd/Ctrl+Enter is the editor's save shortcut: inside a popover it must not also activate the focused button. */
function keepSaveShortcut(e: React.KeyboardEvent) {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.preventDefault();
}

/**
 * Month grid in UTC. `selected` is one day, `range` a highlighted span. Roving tab stop: arrows move by
 * day / week, Home / End to the week's ends, PageUp / PageDown by month (Shift: year); Enter or Space picks.
 */
export function Calendar({ selected = "", initial = "", range, onPick }: { selected?: string; /** Month to open on when nothing is selected (or to override it). */ initial?: string; range?: [string, string]; onPick: (date: string) => void }) {
  const today = todayUtc();
  const [focus, setFocus] = React.useState(parseDate(initial || selected) ?? today);
  const moved = React.useRef(false);
  const ref = React.useRef<HTMLTableElement>(null);
  const titleId = React.useId();

  React.useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    ref.current?.querySelector<HTMLElement>(`[data-date="${focus}"]`)?.focus();
  }, [focus]);

  function onKeyDown(e: React.KeyboardEvent) {
    const next: Record<string, string> = {
      ArrowLeft: addDays(focus, -1),
      ArrowRight: addDays(focus, 1),
      ArrowUp: addDays(focus, -7),
      ArrowDown: addDays(focus, 7),
      Home: addDays(focus, -weekdayIndex(focus)),
      End: addDays(focus, 6 - weekdayIndex(focus)),
      PageUp: addMonths(focus, e.shiftKey ? -12 : -1),
      PageDown: addMonths(focus, e.shiftKey ? 12 : 1),
    };
    if (!(e.key in next) || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    moved.current = true;
    setFocus(next[e.key]);
  }

  const [from, to] = range ?? [selected, selected];
  const arrow = "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-panel-3 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button type="button" className={arrow} aria-label="Previous month" onClick={() => setFocus(addMonths(focus, -1))}>
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <div id={titleId} aria-live="polite" className="text-sm font-semibold text-fg">
          {monthLabel(focus)}
        </div>
        <button type="button" className={arrow} aria-label="Next month" onClick={() => setFocus(addMonths(focus, 1))}>
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <table ref={ref} role="grid" aria-labelledby={titleId} onKeyDown={onKeyDown} className="w-full border-separate border-spacing-y-0.5">
        <thead>
          <tr>
            {WEEKDAYS.map((w) => (
              <th key={w} scope="col" abbr={w} className="h-7 text-[11px] font-medium text-faint">
                {w.slice(0, 2)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthGrid(focus).map((week, w) => (
            <tr key={w}>
              {week.map((d, i) => {
                const inMonth = d.slice(0, 7) === focus.slice(0, 7);
                const edge = d === from || d === to;
                const inRange = !!from && !!to && d >= from && d <= to;
                return (
                  <td key={i} role="gridcell" aria-selected={inRange} className={cn("p-0 text-center", inRange && !edge && "bg-accent/15")}>
                    <button
                      type="button"
                      data-date={d}
                      tabIndex={d === focus ? 0 : -1}
                      aria-label={inMonth ? longDate(d) : `${longDate(d)} (other month)`}
                      aria-current={d === today ? "date" : undefined}
                      onClick={() => onPick(d)}
                      className={cn(
                        "h-8 w-8 rounded-md text-xs tabular focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                        inMonth ? "text-fg" : "text-faint/70",
                        d === today && "font-bold ring-1 ring-accent/60",
                        edge ? "bg-accent-strong text-white" : "hover:bg-panel-3",
                      )}
                    >
                      {Number(d.slice(8))}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const fieldError = "mt-1 text-[11px] text-loss";
const FULL_LENGTH = "YYYY-MM-DD HH:mm".length;

/**
 * UTC date-time field. The text box takes typed "YYYY-MM-DD HH:mm" (a space or T both work, a pasted ISO string
 * too), a date alone (keeps the time) or a time alone (keeps the date); the calendar button opens a popover with
 * the month grid, a 24h time box, Now, and (when `clearable`) Clear. `required` fields flag an empty box instead
 * of clearing. `value` / `onChange` use the editor contract "YYYY-MM-DDTHH:mm" ("" = empty).
 * Invalid text stays in the box and is never committed; the format error shows on blur or once the text is
 * full length, and `onInvalidChange` reports whether the box currently holds invalid text so the editor can
 * block saving. `copyFrom` adds a one-click "same as" button and seeds the empty field's month and time.
 */
export function DateTimeField({
  id,
  label,
  value,
  onChange,
  clearable,
  required,
  hint,
  copyFrom,
  onInvalidChange,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  clearable?: boolean;
  /** An empty box is an error (the field cannot be cleared). */
  required?: boolean;
  hint?: string;
  /** Another field's value: adds a button with this label that copies it, and seeds the calendar month and time. */
  copyFrom?: { label: string; value: string };
  onInvalidChange?: (invalid: boolean) => void;
  /** A message from outside (a failed save), shown under the box like the format error. */
  error?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [blurred, setBlurred] = React.useState(false);
  const [draft, setDraft] = useDraft(value, (s) => parseDateTimeInput(s, value), displayDateTime);
  const [timeDraft, setTimeDraft] = useDraft(splitDateTime(value).time, parseTime);
  const { date, time } = splitDateTime(value);
  const seed = splitDateTime(copyFrom?.value ?? "");
  const textBad = draft.trim() === "" ? !!required : parseDateTimeInput(draft, value) === null;
  const showTextError = textBad && (blurred || draft.trim().length >= FULL_LENGTH);
  const timeBad = parseTime(timeDraft) === null && (timeDraft !== "" || value !== "");

  React.useEffect(() => onInvalidChange?.(textBad), [textBad, onInvalidChange]);

  function apply(v: string) {
    setDraft(displayDateTime(v));
    setTimeDraft(splitDateTime(v).time);
    onChange(v);
  }
  function typed(text: string) {
    setDraft(text);
    setBlurred(false);
    if (text.trim() === "") {
      if (!required) onChange("");
    } else {
      const v = parseDateTimeInput(text, value);
      if (v) onChange(v);
    }
  }
  /** Leaving the box: show any error, and spell out a date-only / time-only entry in full. */
  function blur() {
    setBlurred(true);
    const v = parseDateTimeInput(draft, value);
    if (v) setDraft(displayDateTime(v));
  }
  function typedTime(text: string) {
    setTimeDraft(text);
    const t = parseTime(text);
    if (t) onChange(`${date || seed.date || todayUtc()}T${t}`);
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="truncate text-xs font-medium text-muted">
        {label}
      </label>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Anchor asChild>
          <div className="flex gap-1">
            <Input
              id={id}
              value={draft}
              onChange={(e) => typed(e.target.value)}
              onBlur={blur}
              placeholder="YYYY-MM-DD HH:mm"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={showTextError || !!error}
              aria-describedby={[(showTextError || error) && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(" ") || undefined}
              className="min-w-0 px-2 tabular"
            />
            <Popover.Trigger
              type="button"
              aria-label={`Open calendar for ${label}`}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-panel-2 text-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <CalendarDays className="h-4 w-4" aria-hidden />
            </Popover.Trigger>
          </div>
        </Popover.Anchor>
        <Popover.Portal>
          <Popover.Content align="start" sideOffset={4} collisionPadding={8} aria-label={`${label} calendar`} onOpenAutoFocus={focusDay} onKeyDown={keepSaveShortcut} className={popoverClass}>
            <Calendar selected={date} initial={date ? "" : seed.date} onPick={(d) => apply(`${d}T${parseTime(timeDraft) ?? (time || seed.time || "00:00")}`)} />
            <div className="mt-3 flex items-center gap-2">
              <label htmlFor={`${id}-time`} className="text-xs font-medium text-muted">
                Time (UTC)
              </label>
              <input
                id={`${id}-time`}
                value={timeDraft}
                onChange={(e) => typedTime(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) setOpen(false);
                }}
                placeholder={seed.time || "HH:mm"}
                autoComplete="off"
                aria-invalid={timeBad}
                aria-describedby={timeBad ? `${id}-time-error` : undefined}
                className="h-8 w-20 rounded-md border border-line bg-panel-2 px-2 text-sm text-fg tabular focus:border-accent/70 focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
            {timeBad && (
              <p id={`${id}-time-error`} role="alert" className={fieldError}>
                {TIME_FORMAT}
              </p>
            )}
            <div className="mt-3 flex justify-between gap-2">
              <span className="flex gap-2">
                <Button size="sm" onClick={() => {
                    apply(nowInput());
                    setOpen(false);
                  }}>
                  Now
                </Button>
                {copyFrom?.value && (
                  <Button size="sm" onClick={() => {
                      apply(copyFrom.value);
                      setOpen(false);
                    }}>
                    {copyFrom.label}
                  </Button>
                )}
                {clearable && (
                  <Button size="sm" variant="ghost" onClick={() => {
                      apply("");
                      setOpen(false);
                    }}>
                    Clear
                  </Button>
                )}
              </span>
              <Popover.Close asChild>
                <Button size="sm" variant="primary">
                  Done
                </Button>
              </Popover.Close>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {(showTextError || error) && (
        <p id={`${id}-error`} role="alert" className="text-[11px] text-loss">
          {showTextError ? DATETIME_FORMAT : error}
        </p>
      )}
      {hint && (
        <p id={`${id}-hint`} className="text-[11px] text-faint">
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * UTC date-range filter in one popover: presets, typed From / To (YYYY-MM-DD), a calendar (first click
 * starts the range, second ends it) and Clear. `onChange` is called with "" for an open end.
 */
export function DateRangePicker({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [anchor, setAnchor] = React.useState("");
  // Bumped by typed dates so the calendar jumps to their month (picked values must not re-key it).
  const [sync, setSync] = React.useState({ key: 0, date: "" });
  const [fromDraft, setFromDraft] = useDraft(from, parseDate);
  const [toDraft, setToDraft] = useDraft(to, parseDate);
  const id = React.useId();
  const active = from !== "" || to !== "";
  const summary = from && to ? (from === to ? from : `${from} → ${to}`) : from ? `From ${from}` : to ? `Until ${to}` : "Any date";

  const pf = parseDate(fromDraft);
  const pt = parseDate(toDraft);
  const fromErr = fromDraft.trim() !== "" && !pf ? DATE_FORMAT : pf && pt && pf > pt ? "From must not be after To." : "";
  const toErr = toDraft.trim() !== "" && !pt ? DATE_FORMAT : "";

  function typed(which: "from" | "to", text: string) {
    (which === "from" ? setFromDraft : setToDraft)(text);
    setAnchor("");
    const f = which === "from" ? text : fromDraft;
    const t = which === "to" ? text : toDraft;
    const nf = f.trim() === "" ? "" : parseDate(f);
    const nt = t.trim() === "" ? "" : parseDate(t);
    if (nf === null || nt === null || (nf && nt && nf > nt)) return;
    setSync((s) => ({ key: s.key + 1, date: (which === "from" ? nf : nt) || nf || nt }));
    onChange(nf, nt);
  }
  function pick(d: string) {
    if (!anchor) {
      setAnchor(d);
      onChange(d, "");
    } else {
      finish(...normalizeRange(anchor, d));
    }
  }
  function finish(f: string, t: string) {
    setAnchor("");
    onChange(f, t);
    setOpen(false);
  }

  const box = "h-8 w-full rounded-md border border-line bg-panel-2 px-2 text-xs text-fg tabular placeholder:text-faint focus:border-accent/70 focus:outline-none focus:ring-2 focus:ring-accent/20";
  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        setAnchor("");
      }}
    >
      <Popover.Trigger
        type="button"
        aria-label={`Date range, ${summary}`}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-panel-2 px-2 text-xs text-fg focus:outline-none focus-visible:border-accent/70 focus-visible:ring-2 focus-visible:ring-accent/20",
          active && "border-accent/50 text-accent",
        )}
      >
        <CalendarDays className="h-3 w-3 shrink-0" aria-hidden />
        <span className={cn("tabular", !active && "text-muted")}>{summary}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={4} collisionPadding={8} aria-label="Date range" onOpenAutoFocus={focusDay} onKeyDown={keepSaveShortcut} className={popoverClass}>
          <div className="mb-3 flex flex-wrap gap-1">
            {PRESETS.map((p) => {
              const [a, b] = presetRange(p.id);
              const on = from === a && to === b;
              return (
                <Button key={p.id} size="sm" aria-pressed={on} className={on ? "border-accent/50 bg-accent/15 text-accent" : undefined} onClick={() => finish(a, b)}>
                  {p.label}
                </Button>
              );
            })}
          </div>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <div>
              <label htmlFor={`${id}-from`} className="mb-1 block text-xs font-medium text-muted">
                From (UTC)
              </label>
              <input id={`${id}-from`} value={fromDraft} onChange={(e) => typed("from", e.target.value)} placeholder="YYYY-MM-DD" autoComplete="off" aria-invalid={!!fromErr} aria-describedby={fromErr ? `${id}-from-error` : undefined} className={box} />
            </div>
            <div>
              <label htmlFor={`${id}-to`} className="mb-1 block text-xs font-medium text-muted">
                To (UTC)
              </label>
              <input id={`${id}-to`} value={toDraft} onChange={(e) => typed("to", e.target.value)} placeholder="YYYY-MM-DD" autoComplete="off" aria-invalid={!!toErr} aria-describedby={toErr ? `${id}-to-error` : undefined} className={box} />
            </div>
            {fromErr && (
              <p id={`${id}-from-error`} role="alert" className={cn(fieldError, "col-span-2 mt-0")}>
                {fromErr}
              </p>
            )}
            {toErr && (
              <p id={`${id}-to-error`} role="alert" className={cn(fieldError, "col-span-2 mt-0")}>
                {toErr}
              </p>
            )}
          </div>
          <Calendar key={sync.key} selected={from || to} initial={sync.date} range={from || to ? [from || to, to || from] : undefined} onPick={pick} />
          <div className="mt-3 flex justify-between gap-2">
            <Button size="sm" variant="ghost" onClick={() => finish("", "")}>
              Clear
            </Button>
            <Popover.Close asChild>
              <Button size="sm" variant="primary">
                Done
              </Button>
            </Popover.Close>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
