import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  daysInMonth,
  displayDateTime,
  longDate,
  monthGrid,
  monthLabel,
  normalizeRange,
  nowInput,
  orderRange,
  parseDate,
  parseDateTime,
  parseDateTimeInput,
  parseTime,
  presetRange,
  PRESETS,
  splitDateTime,
  todayUtc,
  weekdayIndex,
} from "./date-input";
import { isoToZonedInput, zonedInputToIso } from "./tz";

const at = (iso: string) => new Date(iso);

describe("parsing", () => {
  it("accepts real dates, including the leap day, and normalises padding", () => {
    expect(parseDate("2026-10-02")).toBe("2026-10-02");
    expect(parseDate(" 2026-1-5 ")).toBe("2026-01-05");
    expect(parseDate("2028-02-29")).toBe("2028-02-29");
  });
  it("rejects impossible dates and junk", () => {
    for (const s of ["2026-02-29", "2100-02-29", "2026-13-01", "2026-00-10", "2026-04-31", "2026-04-00", "0999-01-01", "26-01-01", "", "2026/01/01"])
      expect(parseDate(s), s).toBeNull();
  });
  it("parses 24h times only", () => {
    expect(parseTime("14:30")).toBe("14:30");
    expect(parseTime("9:05")).toBe("09:05");
    expect(parseTime("23:59")).toBe("23:59");
    for (const s of ["24:00", "12:60", "1230", "12:5", "", "aa:bb", "2:30pm"]) expect(parseTime(s), s).toBeNull();
  });
  it("parses date-times with a space or a T, and rejects partial ones", () => {
    expect(parseDateTime("2026-10-02 14:30")).toBe("2026-10-02T14:30");
    expect(parseDateTime("2026-10-02T14:30")).toBe("2026-10-02T14:30");
    expect(parseDateTime("2026-10-02   9:05")).toBe("2026-10-02T09:05");
    for (const s of ["2026-10-02", "14:30", "2026-10-02 25:00", "2026-02-30 10:00", "", "a b c"]) expect(parseDateTime(s), s).toBeNull();
  });
  it("accepts a pasted ISO string (lowercase t, seconds, Z, non-breaking space) but not offsets", () => {
    expect(parseDateTime("2026-10-02T14:30:00Z")).toBe("2026-10-02T14:30");
    expect(parseDateTime("2026-10-02t14:30:59.123z")).toBe("2026-10-02T14:30");
    expect(parseDateTime("2026-10-02\u00a014:30")).toBe("2026-10-02T14:30");
    expect(parseDateTime("  2026-10-02 23:59:59  ")).toBe("2026-10-02T23:59");
    for (const s of ["2026-10-02T14:30:00+02:00", "2026-10-02T24:00:00Z", "2026-10-02T14:30:7", "2026-13-02T14:30:00Z", "2026-10-02T14:30:00ZZ"]) expect(parseDateTime(s), s).toBeNull();
  });
  it("text box input: full value, date only, time only", () => {
    const cur = "2026-10-02T14:30";
    expect(parseDateTimeInput("2026-11-05 09:00", cur)).toBe("2026-11-05T09:00");
    expect(parseDateTimeInput("2026-11-05", cur)).toBe("2026-11-05T14:30"); // keeps the time
    expect(parseDateTimeInput("2026-1-5", "")).toBe("2026-01-05T00:00"); // no time yet
    expect(parseDateTimeInput("9:05", cur)).toBe("2026-10-02T09:05"); // keeps the date
    expect(parseDateTimeInput("23:59", "", "2026-10-03")).toBe("2026-10-03T23:59");
    expect(parseDateTimeInput("23:59", "")).toBe(`${todayUtc()}T23:59`);
    for (const s of ["", "2026-02-30", "24:00", "2026-10", "abc", "2026-10-02 25:00"]) expect(parseDateTimeInput(s, cur), s).toBeNull();
  });
  it("displays and splits the value string", () => {
    expect(displayDateTime("2026-10-02T14:30")).toBe("2026-10-02 14:30");
    expect(splitDateTime("2026-10-02T14:30")).toEqual({ date: "2026-10-02", time: "14:30" });
    expect(splitDateTime("")).toEqual({ date: "", time: "" });
  });
});

describe("round trip with tz.ts (UTC)", () => {
  const cases = ["2026-10-02T14:30", "2026-10-02T00:00", "2026-10-02T23:59", "2026-12-31T23:59", "2027-01-01T00:00", "2028-02-29T12:00", "2028-02-29T23:59", "2028-03-01T00:00", "2026-03-29T01:30", "2026-10-25T01:30"];
  it.each(cases)("%s survives typed → value → ISO → value", (v) => {
    const typed = parseDateTime(displayDateTime(v));
    expect(typed).toBe(v);
    const iso = zonedInputToIso(typed!);
    expect(iso).toBe(`${v}:00.000Z`);
    expect(isoToZonedInput(iso)).toBe(v);
  });
});

describe("calendar maths", () => {
  it("knows month lengths", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
  it("adds days across month, year and leap boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
    expect(addDays("2026-10-02", 7)).toBe("2026-10-09");
  });
  it("adds months, clamping the day and rolling the year", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2026-10-02", 12)).toBe("2027-10-02");
  });
  it("numbers weekdays Monday-first", () => {
    expect(weekdayIndex("2026-10-05")).toBe(0); // Monday
    expect(weekdayIndex("2026-10-04")).toBe(6); // Sunday
    expect(weekdayIndex("2026-10-02")).toBe(4); // Friday
  });
  it("builds a six-week Monday-first grid around the month", () => {
    const g = monthGrid("2026-10-15");
    expect(g).toHaveLength(6);
    expect(g.every((w) => w.length === 7)).toBe(true);
    expect(g[0][0]).toBe("2026-09-28"); // Oct 1 2026 is a Thursday
    expect(g[0][3]).toBe("2026-10-01");
    expect(g[5][6]).toBe("2026-11-08");
    expect(monthGrid("2026-02-10")[0][0]).toBe("2026-01-26");
  });
  it("labels", () => {
    expect(monthLabel("2026-10-02")).toBe("October 2026");
    expect(longDate("2026-10-02")).toBe("2 October 2026, Friday");
  });
  it("clamps navigation to years 1000-9999", () => {
    expect(addDays("9999-12-31", 1)).toBe("9999-12-31");
    expect(addDays("1000-01-01", -1)).toBe("1000-01-01");
    expect(addMonths("9999-12-31", 1)).toBe("9999-12-31");
    expect(addMonths("9999-06-15", 12)).toBe("9999-12-31");
    expect(addMonths("1000-01-15", -1)).toBe("1000-01-01");
    expect(addMonths("1000-06-15", -12)).toBe("1000-01-01");
    expect(addMonths("9999-11-15", 1)).toBe("9999-12-15");
    expect(addMonths("1000-02-15", -1)).toBe("1000-01-15");
    const last = monthGrid("9999-12-15").flat();
    expect(last).toHaveLength(42);
    expect(last.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))).toBe(true);
    expect(monthGrid("1000-01-15").flat().every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))).toBe(true);
    expect(parseDate("10000-01-01")).toBeNull();
  });
  it("normalizes a range: drops junk, keeps open ends, orders a backwards one", () => {
    expect(normalizeRange("2026-10-09", "2026-10-01")).toEqual(["2026-10-01", "2026-10-09"]);
    expect(normalizeRange("2026-10-01", "2026-10-09")).toEqual(["2026-10-01", "2026-10-09"]);
    expect(normalizeRange("2026-1-5", "")).toEqual(["2026-01-05", ""]);
    expect(normalizeRange("", "2026-10-09")).toEqual(["", "2026-10-09"]);
    expect(normalizeRange("junk", "2026-02-30")).toEqual(["", ""]);
    expect(normalizeRange("junk", "2026-10-09")).toEqual(["", "2026-10-09"]);
    expect(normalizeRange("2026-10-05", "2026-10-05")).toEqual(["2026-10-05", "2026-10-05"]);
  });
  it("orders a backwards range", () => {
    expect(orderRange("2026-10-05", "2026-10-01")).toEqual(["2026-10-01", "2026-10-05"]);
    expect(orderRange("2026-10-01", "2026-10-05")).toEqual(["2026-10-01", "2026-10-05"]);
  });
});

describe("now, today and presets (injected clock, UTC)", () => {
  it("uses UTC even when local time is on another day", () => {
    // 23:30 UTC on Oct 2 is already Oct 3 in Tokyo, still Oct 2 here.
    expect(todayUtc(at("2026-10-02T23:30:00Z"))).toBe("2026-10-02");
    expect(nowInput(at("2026-10-02T23:59:59.999Z"))).toBe("2026-10-02T23:59");
    expect(nowInput(at("2026-10-03T00:00:00Z"))).toBe("2026-10-03T00:00");
  });
  it("defaults to the real clock", () => {
    expect(todayUtc()).toBe(new Date().toISOString().slice(0, 10));
    expect(nowInput()).toHaveLength(16);
    expect(presetRange("today")).toHaveLength(2);
  });
  const now = at("2026-10-02T23:30:00Z"); // a Friday
  it("computes every preset", () => {
    expect(presetRange("today", now)).toEqual(["2026-10-02", "2026-10-02"]);
    expect(presetRange("yesterday", now)).toEqual(["2026-10-01", "2026-10-01"]);
    expect(presetRange("week", now)).toEqual(["2026-09-28", "2026-10-02"]);
    expect(presetRange("last7", now)).toEqual(["2026-09-26", "2026-10-02"]);
    expect(presetRange("last30", now)).toEqual(["2026-09-03", "2026-10-02"]);
    expect(presetRange("month", now)).toEqual(["2026-10-01", "2026-10-02"]);
  });
  it("handles boundaries: Monday, year start, leap day", () => {
    expect(presetRange("week", at("2026-10-05T00:00:00Z"))).toEqual(["2026-10-05", "2026-10-05"]);
    expect(presetRange("yesterday", at("2028-03-01T00:00:00Z"))).toEqual(["2028-02-29", "2028-02-29"]);
    expect(presetRange("yesterday", at("2027-01-01T00:00:00Z"))).toEqual(["2026-12-31", "2026-12-31"]);
    expect(presetRange("last30", at("2027-01-10T12:00:00Z"))).toEqual(["2026-12-12", "2027-01-10"]);
    expect(presetRange("last7", at("2028-03-02T00:00:00Z"))).toEqual(["2028-02-25", "2028-03-02"]);
    expect(presetRange("month", at("2028-02-29T10:00:00Z"))).toEqual(["2028-02-01", "2028-02-29"]);
  });
  it("lists the presets", () => {
    expect(PRESETS.map((p) => p.label)).toEqual(["Today", "Yesterday", "This week", "Last 7 days", "Last 30 days", "This month"]);
  });
});
