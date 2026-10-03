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

import { BIAS_LABEL, EXIT_LABEL, fmtCost, fmtNum, fmtPct, fmtPrice, fmtR, rTone } from "./format";

describe("number formatting", () => {
  it("fmtR signs, rounds and dashes missing or non-finite values", () => {
    expect(fmtR(1.236)).toBe("+1.24R");
    expect(fmtR(-0.5, 1)).toBe("-0.5R");
    expect(fmtR(0)).toBe("0.00R");
    expect(fmtR(null)).toBe("—");
    expect(fmtR(undefined)).toBe("—");
    expect(fmtR(Number.NaN)).toBe("—");
  });
  it("fmtCost flips the sign (lost R is negative) and dashes null", () => {
    expect(fmtCost(1.5)).toBe("-1.50R");
    expect(fmtCost(-0.5)).toBe("+0.50R");
    expect(fmtCost(null)).toBe("—");
  });
  it("fmtPct and fmtNum", () => {
    expect(fmtPct(0.4567)).toBe("46%");
    expect(fmtPct(0.4567, 1)).toBe("45.7%");
    expect(fmtPct(null)).toBe("—");
    expect(fmtPct(Number.POSITIVE_INFINITY)).toBe("—");
    expect(fmtNum(1.005, 1)).toBe("1.0");
    expect(fmtNum(undefined)).toBe("—");
    expect(fmtNum(Number.NaN)).toBe("—");
  });
  it("fmtPrice keeps meaningful decimals by magnitude", () => {
    expect(fmtPrice(64250.456)).toBe("64,250.46");
    expect(fmtPrice(-2400)).toBe("-2,400");
    expect(fmtPrice(12.34567)).toBe("12.3457");
    expect(fmtPrice(0.000123)).toBe("0.000123");
    expect(fmtPrice(null)).toBe("—");
    expect(fmtPrice(Number.NaN)).toBe("—");
  });
  it("fmtDateTime and fmtDate dash empty input; fmtDateTime shows the time", () => {
    expect(fmtDateTime(null)).toBe("—");
    expect(fmtDateTime("2026-09-10T23:30:00.000Z")).toBe("10 Sept 2026, 23:30 UTC");
  });
});

describe("rTone", () => {
  it("classifies by the break-even band", () => {
    expect(rTone(null)).toBe("none");
    expect(rTone(undefined)).toBe("none");
    expect(rTone(0.1)).toBe("be");
    expect(rTone(-0.1)).toBe("be");
    expect(rTone(0.3, 0.5)).toBe("be");
    expect(rTone(1)).toBe("win");
    expect(rTone(-1)).toBe("loss");
  });
});

describe("label maps", () => {
  it("are filled in", () => {
    expect(BIAS_LABEL.with).toBe("With HTF");
    expect(EXIT_LABEL.not_filled).toBe("Not filled");
  });
});
