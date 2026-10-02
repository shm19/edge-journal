import { Input } from "../ui";

export function DateTimeField({
  id,
  label,
  value,
  onChange,
  onNow,
  onClear,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onNow: () => void;
  onClear?: () => void;
  hint?: string;
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
      {hint && <p className="text-[11px] text-faint">{hint}</p>}
    </div>
  );
}
