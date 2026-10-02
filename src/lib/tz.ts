// Timezone helpers. The app runs on UTC only (not configurable): every time is stored, entered and shown in UTC.
// The zone-aware helpers remain because sessions need London / New York / Tokyo local hours.

export const APP_TIMEZONE = "UTC";

function parts(date: Date, timeZone: string) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), min: get("minute"), s: get("second") };
}

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function offsetAt(date: Date, timeZone: string): number {
  const { y, m, d, h, min, s } = parts(date, timeZone);
  return Date.UTC(y, m - 1, d, h, min, s) - Math.floor(date.getTime() / 1000) * 1000;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO (UTC) → "YYYY-MM-DDTHH:mm" in `timeZone`, for <input type="datetime-local">. */
export function isoToZonedInput(iso: string | null | undefined, timeZone: string = APP_TIMEZONE): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const { y, m, d: day, h, min } = parts(d, timeZone);
  return `${y}-${pad(m)}-${pad(day)}T${pad(h)}:${pad(min)}`;
}

/** "YYYY-MM-DDTHH:mm" wall-clock time in `timeZone` → ISO (UTC). */
export function zonedInputToIso(value: string, timeZone: string = APP_TIMEZONE): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s || 0);
  // Two passes handle DST transitions.
  let t = asUtc - offsetAt(new Date(asUtc), timeZone);
  t = asUtc - offsetAt(new Date(t), timeZone);
  return new Date(t).toISOString();
}

/** Calendar date ("YYYY-MM-DD") of an instant in `timeZone`. */
export function zonedDate(iso: string, timeZone: string = APP_TIMEZONE): string {
  const { y, m, d } = parts(new Date(iso), timeZone);
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Hour (0-23, fractional minutes) of an instant in `timeZone`. */
export function zonedHour(iso: string, timeZone: string): number {
  const { h, min } = parts(new Date(iso), timeZone);
  return h + min / 60;
}
