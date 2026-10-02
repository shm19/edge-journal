export const METRICS = [
  { key: "expectancy", label: "Expectancy (avg R)" },
  { key: "totalR", label: "Total R" },
  { key: "winRate", label: "Win rate" },
  { key: "count", label: "Trades" },
  { key: "profitFactor", label: "Profit factor" },
] as const;

export type MetricKey = (typeof METRICS)[number]["key"];
