import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { IdeaStatus, Setup, Tag } from "@/db/schema";
import { cn } from "@/lib/cn";
import { fmtR, rTone, STATUS_LABEL } from "@/lib/format";
import { sampleConfidence } from "@/lib/stats";
import { Badge } from "./ui";

const toneClass = { win: "text-win", loss: "text-loss", be: "text-be", none: "text-faint" } as const;

export function RValue({ r, be = 0.1, className, digits }: { r: number | null | undefined; be?: number; className?: string; digits?: number }) {
  return <span className={cn("tabular font-semibold", toneClass[rTone(r, be)], className)}>{fmtR(r, digits)}</span>;
}

const STATUS_COLOR: Record<IdeaStatus, string> = {
  taken: "#818cf8",
  skipped: "#a1a1aa",
  missed: "#fbbf24",
  forward_test: "#22d3ee",
  backtest: "#a78bfa",
};

export function StatusBadge({ status }: { status: IdeaStatus }) {
  return <Badge color={STATUS_COLOR[status]}>{STATUS_LABEL[status]}</Badge>;
}

export function SetupBadge({ setup }: { setup: Pick<Setup, "name" | "color"> | null }) {
  if (!setup) return <span className="text-xs text-faint">No setup</span>;
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-sm text-fg">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: setup.color }} />
      <span className="truncate">{setup.name}</span>
    </span>
  );
}

export function TagChip({ tag }: { tag: Pick<Tag, "name" | "color" | "group"> }) {
  return (
    <Badge color={tag.color} title={tag.group}>
      {tag.name}
    </Badge>
  );
}

export function DirectionBadge({ direction }: { direction: string }) {
  return direction === "long" ? (
    <Badge className="border-emerald-500/30 bg-emerald-500/10 text-win">Long</Badge>
  ) : (
    <Badge className="border-rose-500/30 bg-rose-500/10 text-loss">Short</Badge>
  );
}

export function SampleBadge({ n }: { n: number }) {
  const c = sampleConfidence(n);
  const map = {
    none: { label: "No data", cls: "text-faint" },
    low: { label: `n=${n} · too few to trust`, cls: "text-warn" },
    early: { label: `n=${n} · early read`, cls: "text-sky-300" },
    solid: { label: `n=${n} · solid sample`, cls: "text-win" },
  }[c];
  return <span className={cn("text-[11px] font-medium", map.cls)}>{map.label}</span>;
}

export function Kpi({
  label,
  value,
  sub,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-line bg-panel px-4 py-3", className)}>
      <p className="text-[11px] font-medium uppercase tracking-wider text-faint">{label}</p>
      <div className="mt-1 text-xl font-semibold tabular text-fg">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-muted">{sub}</div> : null}
    </div>
  );
}

export function Markdown({ children, className }: { children: string; className?: string }) {
  if (!children.trim()) return <p className="text-sm text-faint">—</p>;
  return (
    <div className={cn("prose-journal min-w-0 text-sm break-words [overflow-wrap:anywhere]", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
