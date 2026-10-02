"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const AXIS = { stroke: "#52525b", fontSize: 11, tickLine: false, axisLine: false } as const;
const GRID = { stroke: "#27272a", strokeDasharray: "3 3", vertical: false } as const;
const TOOLTIP = {
  contentStyle: { background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 12, color: "#fafafa" },
  labelStyle: { color: "#a1a1aa" },
  itemStyle: { color: "#fafafa" },
  cursor: { fill: "rgba(255,255,255,0.04)" },
} as const;

const fmtR = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}R`;

export function EquityChart({ data, height = 240 }: { data: { n: number; cum: number; label: string }[]; height?: number }) {
  if (data.length === 0) return <ChartEmpty height={height} />;
  const series = [{ n: 0, cum: 0, label: "Start" }, ...data];
  const last = series[series.length - 1].cum;
  const color = last >= 0 ? "#34d399" : "#fb7185";
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <defs>
          <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="n" {...AXIS} />
        <YAxis {...AXIS} tickFormatter={(v: number) => `${v}R`} />
        <ReferenceLine y={0} stroke="#3f3f46" />
        <Tooltip
          {...TOOLTIP}
          formatter={(v) => [fmtR(Number(v)), "Cumulative"]}
          labelFormatter={(_, p) => (p?.[0]?.payload as { label?: string })?.label ?? ""}
        />
        <Area type="monotone" dataKey="cum" stroke={color} strokeWidth={2} fill="url(#eqFill)" dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

const PALETTE = ["#818cf8", "#34d399", "#fbbf24", "#f472b6", "#22d3ee", "#a78bfa", "#fb923c", "#a3e635"];

export function MultiEquityChart({
  series,
  height = 280,
}: {
  series: { key: string; color?: string; points: { n: number; cum: number }[] }[];
  height?: number;
}) {
  if (!series.length) return <ChartEmpty height={height} />;
  const maxN = Math.max(...series.map((s) => s.points.length));
  const rows = Array.from({ length: maxN + 1 }, (_, n) => {
    const row: Record<string, number> = { n };
    for (const s of series) {
      if (n === 0) row[s.key] = 0;
      else if (s.points[n - 1]) row[s.key] = s.points[n - 1].cum;
    }
    return row;
  });
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="n" {...AXIS} />
        <YAxis {...AXIS} tickFormatter={(v: number) => `${v}R`} />
        <ReferenceLine y={0} stroke="#3f3f46" />
        <Tooltip {...TOOLTIP} formatter={(v, name) => [fmtR(Number(v)), String(name)]} labelFormatter={(n) => `Trade #${n}`} />
        <Legend wrapperStyle={{ fontSize: 12, color: "#a1a1aa" }} />
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            stroke={s.color ?? PALETTE[i % PALETTE.length]}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function BarMetricChart({
  data,
  format = "r",
  height = 260,
}: {
  data: { key: string; value: number | null; color?: string }[];
  format?: "r" | "pct" | "count";
  height?: number;
}) {
  const rows = data.filter((d) => d.value != null) as { key: string; value: number; color?: string }[];
  if (!rows.length) return <ChartEmpty height={height} />;
  const fmt = (v: number) => (format === "pct" ? `${Math.round(v * 100)}%` : format === "count" ? String(v) : fmtR(v));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="key" {...AXIS} interval={0} tick={{ fontSize: 11 }} height={rows.length > 6 ? 60 : 30} angle={rows.length > 6 ? -30 : 0} textAnchor={rows.length > 6 ? "end" : "middle"} />
        <YAxis {...AXIS} tickFormatter={fmt} />
        {format === "r" ? <ReferenceLine y={0} stroke="#3f3f46" /> : null}
        <Tooltip {...TOOLTIP} formatter={(v) => [fmt(Number(v)), ""]} separator="" />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={48}>
          {rows.map((r) => (
            <Cell
              key={r.key}
              fill={r.color ?? (format === "r" ? (r.value >= 0 ? "#34d399" : "#fb7185") : "#818cf8")}
              fillOpacity={0.85}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function RHistogram({ rs, height = 220 }: { rs: number[]; height?: number }) {
  if (!rs.length) return <ChartEmpty height={height} />;
  // Buckets of 0.5R from ≤-2 to ≥4.
  const edges = [-Infinity, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 3, 4, Infinity];
  const label = (lo: number, hi: number) => (lo === -Infinity ? `<${hi}` : hi === Infinity ? `${lo}+` : `${lo}…${hi}`);
  const rows = edges.slice(0, -1).map((lo, i) => {
    const hi = edges[i + 1];
    return { key: label(lo, hi), value: rs.filter((r) => r >= lo && r < hi).length, positive: lo >= 0 };
  });
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="key" {...AXIS} interval={0} tick={{ fontSize: 9 }} angle={-35} textAnchor="end" height={42} />
        <YAxis {...AXIS} allowDecimals={false} />
        <Tooltip {...TOOLTIP} formatter={(v) => [String(v), "Trades"]} labelFormatter={(l) => `${l}R`} />
        <Bar dataKey="value" radius={[3, 3, 0, 0]} isAnimationActive={false}>
          {rows.map((r) => (
            <Cell key={r.key} fill={r.positive ? "#34d399" : "#fb7185"} fillOpacity={0.8} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function ChartEmpty({ height }: { height: number }) {
  return (
    <div className="flex items-center justify-center text-sm text-faint" style={{ height }}>
      Not enough closed trades yet
    </div>
  );
}
