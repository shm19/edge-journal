"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { BALANCE_KEYS, parseBalanceParams, type BalanceErrors } from "@/lib/balance";
import { clearBalance, readStoredBalance, storeBalance } from "@/lib/balance-store";
import { parsePrice } from "@/lib/price";
import { Button, Field, Input, Segmented } from "./ui";

export interface BalanceFormValues {
  start: string;
  risk: string;
  mode: string;
  trade: boolean;
  fee: string;
}

/**
 * Inputs of the balance simulator. The URL is the source of truth: Run writes the params (keeping the filters) and the
 * server validates them; errors come back as props. The page remounts this form (key) whenever the URL values change.
 * A valid Run is remembered in localStorage and restored when the tab is opened without balance params. Numbers apply on
 * Run / Enter; the mode toggle applies at once (together with whatever is typed). Reset goes back to `defaults` and
 * forgets the stored run.
 */
export function BalanceForm({ values, errors, defaults }: { values: BalanceFormValues; errors: BalanceErrors; defaults: BalanceFormValues }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const [v, setV] = useState(values);

  const go = (next: URLSearchParams) => start(() => router.replace(`${pathname}?${next}`, { scroll: false }));

  // No balance params in the URL (e.g. arrived from the setup page): reuse the last valid run.
  useEffect(() => {
    const cur = new URLSearchParams(window.location.search);
    const saved = new URLSearchParams(readStoredBalance());
    if (BALANCE_KEYS.some((k) => cur.has(k)) || !BALANCE_KEYS.some((k) => saved.has(k))) return;
    for (const k of BALANCE_KEYS) if (saved.has(k)) cur.set(k, saved.get(k)!);
    router.replace(`${pathname}?${cur}`, { scroll: false });
  }, [router, pathname]);

  const apply = (f: BalanceFormValues) => {
    const own = new URLSearchParams({ start: f.start, risk: f.risk, mode: f.mode, fee: f.fee });
    if (f.trade) own.set("trade", "1");
    if (!Object.keys(parseBalanceParams(Object.fromEntries(own), 1).errors).length) storeBalance(own.toString());
    const next = new URLSearchParams(window.location.search);
    for (const k of BALANCE_KEYS) next.delete(k);
    for (const [k, val] of own) next.set(k, val);
    go(next);
  };
  const run = (e: React.FormEvent) => {
    e.preventDefault();
    apply(v);
  };
  const reset = () => {
    setV(defaults);
    clearBalance();
    const next = new URLSearchParams(window.location.search);
    for (const k of BALANCE_KEYS) next.delete(k);
    go(next);
  };

  const risk = parsePrice(v.risk);
  const riskHint =
    risk != null && risk > 0 && risk <= 100
      ? `${+risk.toFixed(4)}% risk: a -1R loss costs ${+risk.toFixed(4)}% of the ${v.mode === "fixed" ? "starting " : ""}balance, +2R gains ${+(2 * risk).toFixed(4)}%`
      : "Percent: 1 = 1%";

  return (
    <form onSubmit={run} className="mb-4 grid grid-cols-[repeat(4,minmax(0,1fr))_auto] items-start gap-3 rounded-xl border border-line bg-panel p-4" noValidate>
      <Field label="Starting balance ($)" htmlFor="bal-start" error={errors.start}>
        <Input id="bal-start" inputMode="decimal" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value })} aria-invalid={!!errors.start} />
      </Field>
      <Field label={v.trade ? "Fallback risk (%)" : "Risk per trade (%)"} htmlFor="bal-risk" error={errors.risk} hint={riskHint}>
        <Input id="bal-risk" inputMode="decimal" value={v.risk} onChange={(e) => setV({ ...v, risk: e.target.value })} aria-invalid={!!errors.risk} />
      </Field>
      <Field label="Mode" error={errors.mode} hint={v.mode === "fixed" ? "Risk % of the starting balance" : "Risk % of the current balance"}>
        <Segmented
          label="Mode"
          value={v.mode as "compounding" | "fixed"}
          onChange={(mode) => {
            setV({ ...v, mode });
            apply({ ...v, mode });
          }}
          options={[
            { value: "compounding", label: "Compounding" },
            { value: "fixed", label: "Fixed" },
          ]}
        />
      </Field>
      <Field label="Fee per trade ($)" htmlFor="bal-fee" error={errors.fee} hint="Optional, 0 if empty">
        <Input id="bal-fee" inputMode="decimal" value={v.fee} onChange={(e) => setV({ ...v, fee: e.target.value })} aria-invalid={!!errors.fee} />
      </Field>
      <Button type="submit" variant="primary" className="mt-6" disabled={pending}>
        Run
      </Button>
      <div className="col-span-full flex items-center justify-between gap-2 text-xs">
        <label className="flex items-center gap-2 text-muted">
          <input type="checkbox" checked={v.trade} onChange={(e) => setV({ ...v, trade: e.target.checked })} className="h-4 w-4 accent-[var(--color-accent)]" />
          Use each trade&apos;s own risk
        </label>
        <button type="button" onClick={reset} className="text-accent hover:underline">
          Reset
        </button>
      </div>
    </form>
  );
}
