import { describe, expect, it } from "vitest";
import { fmtDate, fmtDateTime, fmtDrawdown, fmtProfitFactor } from "./format";
import { cachedFormatter } from "./tz";

describe("fmtProfitFactor", () => {
  it("shows a number, infinity for wins without losses, and a dash for nothing", () => {
    expect(fmtProfitFactor({ profitFactor: 1.666, wins: 2 })).toBe("1.67");
    expect(fmtProfitFactor({ profitFactor: null, wins: 3 })).toBe("∞");
    expect(fmtProfitFactor({ profitFactor: null, wins: 0 })).toBe("—");
  });
});

describe("fmtDrawdown", () => {
  it("is a dash only for an empty sample; a real zero is 0.00R", () => {
    expect(fmtDrawdown({ maxDrawdown: 0, count: 0 })).toBe("—");
    expect(fmtDrawdown({ maxDrawdown: 0, count: 4 })).toBe("0.00R");
    expect(fmtDrawdown({ maxDrawdown: 2.5, count: 4 })).toBe("-2.50R");
  });
});

describe("date formatting + formatter cache", () => {
  it("formats in UTC", () => {
    expect(fmtDate("2026-09-10T23:30:00.000Z")).toBe("10 Sept 26");
    expect(fmtDateTime("2026-09-10T23:30:00.000Z")).toContain("UTC");
    expect(fmtDate(null)).toBe("—");
  });
  it("reuses one formatter per locale + options", () => {
    const a = cachedFormatter("en-US", { weekday: "short", timeZone: "UTC" });
    expect(cachedFormatter("en-US", { weekday: "short", timeZone: "UTC" })).toBe(a);
    expect(cachedFormatter("en-US", { weekday: "short", timeZone: "Asia/Tokyo" })).not.toBe(a);
  });
});
