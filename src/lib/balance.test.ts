import { describe, expect, it } from "vitest";
import { balanceQuery, parseBalanceParams, simOptions, VIEW_KEYS } from "./balance";

const parse = (sp: Record<string, string | string[] | undefined>) => parseBalanceParams(sp, 1.5);

describe("parseBalanceParams", () => {
  it("absent params take the defaults (risk from Settings)", () => {
    expect(parse({})).toEqual({ inputs: { start: 1000, riskPct: 1.5, mode: "compounding", useTradeRisk: false, fee: 0 }, errors: {} });
  });

  it("reads valid values, a decimal comma, an array param and trade=1", () => {
    const { inputs, errors } = parse({ start: "2500", risk: "0,5", mode: "fixed", fee: "1.25", trade: "1" });
    expect(inputs).toEqual({ start: 2500, riskPct: 0.5, mode: "fixed", useTradeRisk: true, fee: 1.25 });
    expect(errors).toEqual({});
    expect(parse({ start: ["300", "9"] }).inputs.start).toBe(300);
  });

  it("parses numbers like prices: thousands separators, decimal commas, no hex or junk", () => {
    expect(parse({ start: "1,000" })).toMatchObject({ inputs: { start: 1000 }, errors: {} });
    expect(parse({ start: "1,000.50" }).inputs.start).toBe(1000.5);
    expect(parse({ start: "1.234,5" }).inputs.start).toBe(1234.5);
    expect(parse({ start: "1e3" }).inputs.start).toBe(1000);
    expect(parse({ start: "0x10" }).errors.start).toBeDefined();
    expect(parse({ fee: "1,000" }).inputs.fee).toBe(1000);
  });

  it("a Settings default risk that is not > 0 is treated as 1%", () => {
    expect(parseBalanceParams({}, 0).inputs.riskPct).toBe(1);
    expect(parseBalanceParams({}, -2).inputs.riskPct).toBe(1);
    expect(parseBalanceParams({}, Number.NaN).inputs.riskPct).toBe(1);
    expect(parseBalanceParams({ risk: "2" }, 0).inputs.riskPct).toBe(2);
  });

  it("simOptions maps the fee to feePerTrade", () => {
    expect(simOptions({ start: 5, riskPct: 2, mode: "fixed", useTradeRisk: true, fee: 3 })).toEqual({ start: 5, riskPct: 2, mode: "fixed", useTradeRisk: true, feePerTrade: 3 });
  });

  it("an empty fee means 0, but an empty start or risk is an error", () => {
    expect(parse({ fee: " " })).toMatchObject({ inputs: { fee: 0 }, errors: {} });
    expect(parse({ start: "" }).errors.start).toMatch(/more than 0/);
    expect(parse({ risk: "" }).errors.risk).toBeDefined();
  });

  it("rejects bad numbers with an inline error instead of falling back", () => {
    expect(parse({ start: "0" }).errors.start).toBeDefined();
    expect(parse({ start: "-5" }).errors.start).toBeDefined();
    expect(parse({ start: "abc" }).errors.start).toBeDefined();
    expect(parse({ start: "1e13" }).errors.start).toBeDefined();
    expect(parse({ risk: "0" }).errors.risk).toBeDefined();
    expect(parse({ risk: "101" }).errors.risk).toMatch(/percent/);
    expect(parse({ risk: "100" }).errors.risk).toBeUndefined();
    expect(parse({ fee: "-1" }).errors.fee).toBeDefined();
    expect(parse({ fee: "x" }).errors.fee).toBeDefined();
    expect(parse({ mode: "martingale" }).errors.mode).toBeDefined();
    // the bad field keeps its default in `inputs`, the errors are what the UI must show
    expect(parse({ start: "abc" }).inputs.start).toBe(1000);
  });

  it("reports several errors at once", () => {
    expect(Object.keys(parse({ start: "0", risk: "0", fee: "-1", mode: "x" }).errors).sort()).toEqual(["fee", "mode", "risk", "start"]);
  });
});

describe("balanceQuery", () => {
  it("round-trips through parseBalanceParams", () => {
    const inputs = { start: 1500, riskPct: 0.75, mode: "fixed" as const, useTradeRisk: true, fee: 2 };
    expect(balanceQuery(inputs)).toBe("start=1500&risk=0.75&mode=fixed&fee=2&trade=1");
    expect(parse(Object.fromEntries(new URLSearchParams(balanceQuery(inputs)))).inputs).toEqual(inputs);
    expect(balanceQuery({ ...inputs, useTradeRisk: false })).not.toContain("trade");
  });
  it("VIEW_KEYS keeps the balance inputs out of the idea filters", () => {
    expect(VIEW_KEYS).toEqual(expect.arrayContaining(["tab", "start", "risk", "mode", "trade", "fee"]));
  });
});
