// Pure UTC date maths behind the calendar pickers. Dates are "YYYY-MM-DD" strings, date-times are
// "YYYY-MM-DDTHH:mm" strings (UTC, the editor value contract in tz.ts); nothing here reads the local zone.
// The pure helpers take "now" as a parameter (default: the real clock) so tests can pin it; the components read
// the clock through todayUtc. Years are limited to 1000-9999 so toISOString never produces a "+010000" year.

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** Monday first. */
export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export type RangePreset = "today" | "yesterday" | "week" | "last7" | "last30" | "month";
export const PRESETS: { id: RangePreset; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "week", label: "This week" },
  { id: "last7", label: "Last 7 days" },
  { id: "last30", label: "Last 30 days" },
  { id: "month", label: "This month" },
];

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
export const formatDate = (y: number, m: number, d: number) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
const split = (date: string) => date.split("-").map(Number) as [number, number, number];
const MIN_MS = Date.UTC(1000, 0, 1);
const MAX_MS = Date.UTC(9999, 11, 31);
/** Clamped to years 1000-9999. */
const fromMs = (ms: number) => new Date(Math.min(Math.max(ms, MIN_MS), MAX_MS)).toISOString().slice(0, 10);
const toMs = (date: string) => {
  const [y, m, d] = split(date);
  return Date.UTC(y, m - 1, d);
};

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** "2026-1-5" → "2026-01-05"; null unless it is a real calendar date (leap years included). */
export function parseDate(s: string): string | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1000 || mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return formatDate(y, mo, d);
}

/** "9:05" → "09:05"; 24h only, null when invalid. */
export function parseTime(s: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return `${pad(Number(m[1]))}:${m[2]}`;
}

/** Date-time shape: "2026-10-02 14:30", "2026-10-02T14:30", a pasted ISO "2026-10-02T14:30:00Z" (seconds and Z dropped), any case, nbsp ok. */
const DATETIME = /^(\d{4}-\d{1,2}-\d{1,2})[Tt\s]+(\d{1,2}:\d{2})(?::\d{2}(?:\.\d+)?)?[Zz]?$/;

/** Null when invalid. */
export function parseDateTime(s: string): string | null {
  const m = DATETIME.exec(s.trim());
  const date = m ? parseDate(m[1]) : null;
  const time = m ? parseTime(m[2]) : null;
  return date && time ? `${date}T${time}` : null;
}

/**
 * What the editor's text box accepts: a full date-time, a date alone (keeps the current time, 00:00 when there is
 * none) or a time alone (keeps the current date, `today` when there is none). `current` is the value string.
 */
export function parseDateTimeInput(s: string, current: string, today: string = todayUtc()): string | null {
  const full = parseDateTime(s);
  if (full) return full;
  const { date, time } = splitDateTime(current);
  const d = parseDate(s);
  if (d) return `${d}T${time || "00:00"}`;
  const t = parseTime(s);
  return t ? `${date || today}T${t}` : null;
}

/** Value string → what the text field shows ("2026-10-02 14:30"). */
export const displayDateTime = (value: string) => value.replace("T", " ");

export const splitDateTime = (value: string): { date: string; time: string } => {
  const [date = "", time = ""] = value.split("T");
  return { date, time };
};

export const todayUtc = (now: Date = new Date()) => now.toISOString().slice(0, 10);
export const nowInput = (now: Date = new Date()) => now.toISOString().slice(0, 16);

export const addDays = (date: string, n: number) => fromMs(toMs(date) + n * 86_400_000);

/** Same day next month, clamped to the target month's length (Jan 31 + 1 → Feb 28/29). */
export function addMonths(date: string, n: number): string {
  const [y, m, d] = split(date);
  const total = y * 12 + (m - 1) + n;
  if (total < 1000 * 12) return "1000-01-01";
  if (total >= 10_000 * 12) return "9999-12-31";
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return formatDate(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/** 0 = Monday … 6 = Sunday. */
export const weekdayIndex = (date: string) => (new Date(toMs(date)).getUTCDay() + 6) % 7;

/** Six Monday-first weeks (42 dates) covering the month of `date`, so the grid height never jumps. */
export function monthGrid(date: string): string[][] {
  const [y, m] = split(date);
  const first = formatDate(y, m, 1);
  const start = addDays(first, -weekdayIndex(first));
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)));
}

export const monthLabel = (date: string) => {
  const [y, m] = split(date);
  return `${MONTHS[m - 1]} ${y}`;
};

/** "2 October 2026, Friday" for screen readers: starts with the visible day number (label in name). */
export const longDate = (date: string) => {
  const [y, m, d] = split(date);
  return `${d} ${MONTHS[m - 1]} ${y}, ${WEEKDAYS[weekdayIndex(date)]}`;
};

/** Put the two ends in order (a range typed or clicked backwards). */
export const orderRange = (a: string, b: string): [string, string] => (a <= b ? [a, b] : [b, a]);

/** Both ends as valid "YYYY-MM-DD" or "" (junk is dropped), in order. For URL params, typed text and clicks alike. */
export function normalizeRange(from: string, to: string): [string, string] {
  const f = parseDate(from) ?? "";
  const t = parseDate(to) ?? "";
  return f && t ? orderRange(f, t) : [f, t];
}

/** Preset → [from, to] in UTC. Weeks start on Monday; "week" and "month" run up to today. */
export function presetRange(preset: RangePreset, now: Date = new Date()): [string, string] {
  const today = todayUtc(now);
  switch (preset) {
    case "today":
      return [today, today];
    case "yesterday":
      return [addDays(today, -1), addDays(today, -1)];
    case "week":
      return [addDays(today, -weekdayIndex(today)), today];
    case "last7":
      return [addDays(today, -6), today];
    case "last30":
      return [addDays(today, -29), today];
    case "month":
      return [`${today.slice(0, 7)}-01`, today];
  }
}
