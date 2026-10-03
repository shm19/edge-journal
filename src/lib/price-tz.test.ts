import { describe, expect, it } from "vitest";
import { parsePrice } from "./price";
import { isoToZonedInput, zonedDate, zonedInputToIso } from "./tz";

describe("parsePrice", () => {
  it.each([
    ["64250", 64250],
    ["64,250", 64250],
    ["64,250.5", 64250.5],
    ["1,234,567.25", 1234567.25],
    ["1.234,5", 1234.5],
    ["0,5", 0.5],
    ["1,25", 1.25],
    ["0.000123", 0.000123],
    [" 2400 ", 2400],
    ["1e-5", 0.00001],
    [".5", 0.5],
  ])("%s → %s", (raw, expected) => {
    expect(parsePrice(raw)).toBeCloseTo(expected, 10);
  });

  it.each(["", "abc", "1.2.3", "--1", "1,2,3"])("rejects %j", (raw) => {
    expect(parsePrice(raw)).toBeNull();
  });
});

describe("timezone conversion", () => {
  it("round-trips through a positive-offset zone", () => {
    const iso = zonedInputToIso("2026-10-02T12:00", "Asia/Tehran");
    expect(iso).toBe("2026-10-02T08:30:00.000Z");
    expect(isoToZonedInput(iso, "Asia/Tehran")).toBe("2026-10-02T12:00");
  });

  it("handles UTC", () => {
    expect(zonedInputToIso("2026-09-30T22:00", "UTC")).toBe("2026-09-30T22:00:00.000Z");
  });

  it("handles DST zones", () => {
    // New York is UTC-4 in summer, UTC-5 in winter.
    expect(zonedInputToIso("2026-07-01T09:30", "America/New_York")).toBe("2026-07-01T13:30:00.000Z");
    expect(zonedInputToIso("2026-12-01T09:30", "America/New_York")).toBe("2026-12-01T14:30:00.000Z");
  });

  it("gives the calendar date in a zone", () => {
    expect(zonedDate("2026-09-30T22:00:00.000Z", "Asia/Tehran")).toBe("2026-10-01");
    expect(zonedDate("2026-09-30T22:00:00.000Z", "UTC")).toBe("2026-09-30");
  });
});

describe("parsePrice edge cases", () => {
  it("accepts a trailing dot and rejects overflow to Infinity", () => {
    expect(parsePrice("5.")).toBe(5);
    expect(parsePrice("1e999")).toBeNull();
  });
});

describe("tz edge cases", () => {
  it("returns empty / null on blank or invalid input", () => {
    expect(isoToZonedInput(null)).toBe("");
    expect(isoToZonedInput("not a date")).toBe("");
    expect(zonedInputToIso("2026-09-30")).toBeNull();
  });
  it("accepts seconds in the wall-clock string", () => {
    expect(zonedInputToIso("2026-09-30T22:00:30", "UTC")).toBe("2026-09-30T22:00:30.000Z");
  });
});
