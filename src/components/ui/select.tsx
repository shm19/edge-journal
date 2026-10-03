"use client";

import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { Check, ChevronDown } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/cn";

/** Show the search box only above this many options. */
export const SEARCH_THRESHOLD = 8;
const TYPEAHEAD_MS = 700;

/** What `onChange` receives: the part of a native change event that call sites read. */
export type SelectChangeEvent = { target: { value: string } };

type Item = { value: string; label: string; disabled: boolean; group: string | null };

function toText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(toText).join("");
  return React.isValidElement<{ children?: React.ReactNode }>(node) ? toText(node.props.children) : "";
}

/** Flatten `<option>` / `<optgroup>` children (fragments and arrays included) into items. */
function parseItems(children: React.ReactNode, group: string | null = null, out: Item[] = []): Item[] {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    const p = child.props as { value?: string | number; label?: string; disabled?: boolean; children?: React.ReactNode };
    if (child.type === "option") {
      const label = toText(p.children);
      out.push({ value: p.value == null ? label : String(p.value), label, disabled: !!p.disabled, group });
    } else if (child.type === "optgroup") parseItems(p.children, p.label ?? "", out);
    else parseItems(p.children, group, out);
  });
  return out;
}

export type SelectProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value" | "onChange" | "children"> & {
  value: string | number;
  onChange: (e: SelectChangeEvent) => void;
  children: React.ReactNode;
  /** Form field name: renders a hidden input so the value posts with a form. */
  name?: string;
  size?: "md" | "sm";
  /** Accent the trigger (e.g. a filter that is currently narrowing the list). */
  active?: boolean;
};

/** Search matches the label only (never the index-based item value). */
const labelFilter = (_value: string, search: string, keywords?: string[]) =>
  (keywords?.[0] ?? "").toLowerCase().includes(search.trim().toLowerCase()) ? 1 : 0;

/**
 * Searchable, keyboard-accessible replacement for the native select element. Same API: <option>/<optgroup>
 * children, `value`, `onChange(e)` with `e.target.value`, `id`, `aria-label`, `disabled`.
 * Radix Popover does positioning (flip, collision), outside click and focus return; cmdk does the
 * listbox (arrows, Home/End, Enter, search). Short lists get a visually hidden input for type-ahead.
 * Tab inside the list commits nothing: it closes the list and focus returns to the trigger.
 * On the closed trigger a printable key opens the list and seeds the search / type-ahead.
 * Items render in source order, with consecutive options of the same <optgroup> under one heading.
 */
export function Select({ value, onChange, children, name, size = "md", active: accent, className, disabled, onKeyDown, ...props }: SelectProps) {
  const id = React.useId();
  const val = (i: number) => `${id}-${i}`;
  const items = parseItems(children);
  const current = String(value);
  const selected = items.findIndex((i) => i.value === current);
  const searchable = items.length > SEARCH_THRESHOLD;
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function onOpenChange(next: boolean, seed = "") {
    setOpen(next);
    setQuery("");
    clearTimeout(timer.current);
    if (next) {
      // Start on the selected option, or the first enabled one.
      const start = selected >= 0 && !items[selected].disabled ? selected : items.findIndex((i) => !i.disabled);
      setActive(val(Math.max(start, 0)));
      if (seed) onQuery(seed);
    }
  }

  function onQuery(q: string) {
    setQuery(q);
    if (searchable) return;
    // Type-ahead: jump to the first option starting with what was typed, forget it after a pause.
    const at = items.findIndex((i) => !i.disabled && i.label.toLowerCase().startsWith(q.trim().toLowerCase()));
    // cmdk re-highlights the first item after every search change, so jump on the next tick.
    if (q.trim() && at >= 0) setTimeout(() => setActive(val(at)), 0);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setQuery(""), TYPEAHEAD_MS);
  }

  function pick(item: Item) {
    onOpenChange(false);
    if (item.value !== current) onChange({ target: { value: item.value } });
  }

  // cmdk's own handler would select an item on Cmd/Ctrl+Enter, which the editor uses to save.
  function onListKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.preventDefault();
    // Tab commits nothing; Radix returns focus to the trigger, so the next Tab moves on.
    if (e.key === "Tab") {
      e.preventDefault();
      onOpenChange(false);
    }
  }

  const renderItem = (item: Item, i: number) => (
    <Command.Item
      key={i}
      value={val(i)}
      keywords={[item.label]}
      disabled={item.disabled}
      aria-current={i === selected ? "true" : undefined}
      onSelect={() => pick(item)}
      className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm text-fg data-[selected=true]:bg-panel-3 data-[disabled=true]:cursor-default data-[disabled=true]:opacity-50"
    >
      <span className="truncate">
        {item.label}
        {i === selected && item.value !== "" && (
          <>
            {" "}
            <span className="sr-only">(selected)</span>
          </>
        )}
      </span>
      {i === selected && item.value !== "" && <Check className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />}
    </Command.Item>
  );

  // cmdk labels its input with the Command label (aria-labelledby wins over aria-label), so they must match.
  const inputLabel = searchable ? "Search options" : "Type to jump to an option";
  // Runs of consecutive items with the same group, so everything renders in source order.
  const runs: { group: string | null; at: number[] }[] = [];
  items.forEach((item, i) => {
    const last = runs[runs.length - 1];
    if (last && last.group === item.group) last.at.push(i);
    else runs.push({ group: item.group, at: [i] });
  });

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger
        type="button"
        role="combobox"
        disabled={disabled}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (e.defaultPrevented) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            onOpenChange(true);
          } else if (e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            onOpenChange(true, e.key);
          }
        }}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-panel-2 text-left text-fg focus:outline-none focus-visible:border-accent/70 focus-visible:ring-2 focus-visible:ring-accent/20 disabled:opacity-60",
          accent && "border-accent/50 text-accent",
          size === "sm" ? "h-8 px-2 text-xs" : "h-9 px-3 text-sm",
          className,
        )}
        {...props}
      >
        <span className={cn("truncate", (selected < 0 || items[selected].value === "") && "text-muted")}>{selected < 0 ? "Select…" : items[selected].label}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-muted" aria-hidden />
      </Popover.Trigger>
      {name && <input type="hidden" name={name} value={current} disabled={disabled} />}
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          collisionPadding={{ top: 8, left: 8, right: 8, bottom: 72 }}
          aria-label={props["aria-label"] ?? "Options"}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
          className="z-50 w-max min-w-(--radix-popover-trigger-width) max-w-80 rounded-lg border border-line-strong bg-panel p-1 shadow-xl shadow-black/40"
        >
          <Command
            shouldFilter={searchable}
            filter={labelFilter}
            value={active}
            onValueChange={setActive}
            onKeyDown={onListKeyDown}
            label={inputLabel}
            loop
          >
            <Command.Input
              ref={inputRef}
              value={query}
              onValueChange={onQuery}
              placeholder={searchable ? "Search…" : undefined}
              aria-label={inputLabel}
              className={
                searchable
                  ? "mb-1 h-8 w-full rounded-md border border-line bg-panel-2 px-2 text-xs text-fg placeholder:text-faint focus:outline-none focus:border-accent/70"
                  : "sr-only"
              }
            />
            <Command.List
              label={props["aria-label"] ?? "Options"}
              className="overflow-y-auto"
              style={{ maxHeight: "min(20rem, var(--radix-popover-content-available-height))" }}
            >
              <Command.Empty className="px-2 py-3 text-center text-xs text-muted">No matches</Command.Empty>
              {runs.map((run, r) =>
                run.group == null ? (
                  <React.Fragment key={r}>{run.at.map((i) => renderItem(items[i], i))}</React.Fragment>
                ) : (
                <Command.Group
                  key={r}
                  heading={run.group}
                  className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-faint"
                >
                  {run.at.map((i) => renderItem(items[i], i))}
                </Command.Group>
                ),
              )}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
