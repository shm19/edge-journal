// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/analytics",
}));

import { simulateBalance } from "@/lib/stats";
import { readStoredBalance } from "@/lib/balance-store";
import { BalanceForm } from "./balance-form";
import { BalanceResults } from "./balance-results";

const values = { start: "1000", risk: "1", mode: "compounding", trade: false, fee: "0" };

describe("BalanceForm", () => {
  beforeEach(() => {
    replace.mockClear();
    window.localStorage.clear();
    window.history.replaceState(null, "", "/analytics?tab=balance&setup=3&start=1000");
  });

  it("Run writes the inputs to the URL, keeps the filters and remembers them", async () => {
    render(<BalanceForm values={values} defaults={values} errors={{}} />);
    await userEvent.clear(screen.getByLabelText("Starting balance ($)"));
    await userEvent.type(screen.getByLabelText("Starting balance ($)"), "2000");
    await userEvent.click(screen.getByRole("radio", { name: "Fixed" }));
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "Run" }));
    const url = replace.mock.calls.at(-1)![0] as string;
    expect(url).toBe("/analytics?tab=balance&setup=3&start=2000&risk=1&mode=fixed&fee=0&trade=1");
    expect(window.localStorage.getItem("edge-journal.balance-inputs")).toBe("start=2000&risk=1&mode=fixed&fee=0&trade=1");
  });

  it("does not remember invalid inputs, and shows the server's errors inline", async () => {
    render(<BalanceForm values={{ ...values, start: "0" }} defaults={values} errors={{ start: "Starting balance must be more than 0" }} />);
    expect(screen.getByText("Starting balance must be more than 0")).toBeInTheDocument();
    expect(screen.getByLabelText("Starting balance ($)")).toHaveAttribute("aria-invalid", "true");
    await userEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(window.localStorage.getItem("edge-journal.balance-inputs")).toBeNull();
    expect(replace).toHaveBeenCalledTimes(1); // still sent: the server answers with the error
  });

  it("restores the last run when the URL has no balance params", () => {
    window.history.replaceState(null, "", "/analytics?tab=balance&setup=3");
    window.localStorage.setItem("edge-journal.balance-inputs", "start=500&risk=2&mode=fixed&fee=0");
    render(<BalanceForm values={values} defaults={values} errors={{}} />);
    expect(replace).toHaveBeenCalledWith("/analytics?tab=balance&setup=3&start=500&risk=2&mode=fixed&fee=0", { scroll: false });
  });

  it("does not redirect when the URL already has inputs or nothing is stored", () => {
    window.localStorage.setItem("edge-journal.balance-inputs", "start=500");
    render(<BalanceForm values={values} defaults={values} errors={{}} />); // URL has start=1000
    window.history.replaceState(null, "", "/analytics?tab=balance");
    window.localStorage.clear();
    render(<BalanceForm values={values} defaults={values} errors={{}} />);
    expect(replace).not.toHaveBeenCalled();
  });

  it("the mode toggle applies at once; numbers wait for Run", async () => {
    render(<BalanceForm values={values} defaults={values} errors={{}} />);
    await userEvent.click(screen.getByRole("radio", { name: "Fixed" }));
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace.mock.calls[0][0]).toContain("mode=fixed");
    replace.mockClear();
    await userEvent.type(screen.getByLabelText("Starting balance ($)"), "5");
    expect(replace).not.toHaveBeenCalled();
  });

  it("Reset restores the defaults, forgets the stored run and drops the balance params", async () => {
    const defaults = { ...values, start: "1000", risk: "1.5" };
    window.localStorage.setItem("edge-journal.balance-inputs", "start=500&risk=2&mode=fixed&fee=0");
    window.history.replaceState(null, "", "/analytics?tab=balance&setup=3&start=500&risk=2");
    render(<BalanceForm values={{ ...values, start: "500", risk: "2" }} defaults={defaults} errors={{}} />);
    replace.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByLabelText("Starting balance ($)")).toHaveValue("1000");
    expect(screen.getByLabelText("Risk per trade (%)")).toHaveValue("1.5");
    expect(readStoredBalance()).toBe("");
    expect(replace).toHaveBeenLastCalledWith("/analytics?tab=balance&setup=3", { scroll: false });
  });

  it("own-risk checkbox is its own row and renames the risk field to a fallback", async () => {
    render(<BalanceForm values={values} defaults={values} errors={{}} />);
    expect(screen.getByLabelText("Risk per trade (%)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Use each trade's own risk" }));
    expect(screen.getByLabelText("Fallback risk (%)")).toBeInTheDocument();
  });

  it("explains risk in plain words, follows the typed value, and labels the mode group", async () => {
    render(<BalanceForm values={values} defaults={values} errors={{}} />);
    expect(screen.getByText("1% risk: a -1R loss costs 1% of the balance, +2R gains 2%")).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Mode" })).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Risk per trade (%)"));
    await userEvent.type(screen.getByLabelText("Risk per trade (%)"), "0,5");
    expect(screen.getByText("0.5% risk: a -1R loss costs 0.5% of the balance, +2R gains 1%")).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Risk per trade (%)"));
    await userEvent.type(screen.getByLabelText("Risk per trade (%)"), "abc");
    expect(screen.getByText("Percent: 1 = 1%")).toBeInTheDocument();
  });

  it("Run is disabled while the navigation is pending", async () => {
    let done!: () => void;
    replace.mockReturnValueOnce(new Promise<void>((r) => (done = r)));
    render(<BalanceForm values={values} defaults={values} errors={{}} />);
    await userEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    await act(async () => done());
    expect(screen.getByRole("button", { name: "Run" })).toBeEnabled();
  });

  it("still works when storage is blocked", async () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<BalanceForm values={values} defaults={values} errors={{}} />);
    await userEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(replace).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    get.mockRestore();
  });
});

describe("BalanceResults", () => {
  const pts = [2, -1, 3].map((r, i) => ({ id: i + 1, r, date: `2026-01-0${i + 1}T00:00:00.000Z`, riskPct: null }));
  const meta = { 1: { setup: "LHPB", status: "taken" as const }, 2: { setup: "LHPB", status: "taken" as const }, 3: { setup: "Wick", status: "taken" as const } };
  const props = { meta, statuses: ["taken" as const], defaultRiskPct: 1, useTradeRisk: false };
  const sim = (o = {}) => simulateBalance(pts, { start: 1000, riskPct: 1, mode: "compounding", useTradeRisk: false, ...o });

  it("shows the hand-calculated numbers, the hypothetical note and the small-sample warning", () => {
    render(<BalanceResults sim={sim()} {...props} />);
    expect(screen.getByText(/Hypothetical: assumes the stated risk on every trade; not your real account/)).toBeInTheDocument();
    expect(screen.getByText(/too few to trust until you have 20\+/)).toBeInTheDocument();
    expect(screen.getAllByText("$1,040.09").length).toBeGreaterThan(0); // ending balance + last row
    expect(screen.getByText("+$40.09")).toBeInTheDocument();
    expect(screen.getByText(/\+4\.01% return/)).toBeInTheDocument();
    expect(screen.getAllByText("-$10.20")).toHaveLength(3); // largest loss (1% of 1020), max drawdown, and the row
    expect(screen.getByText("$1,009.80")).toBeInTheDocument();
    expect(screen.queryByText(/Not live results/)).not.toBeInTheDocument();
  });

  it("shows R total with the risk, a table caption, column scopes, a chart summary and a live region", () => {
    const { container } = render(<BalanceResults sim={sim()} {...props} />);
    expect(screen.getByText("Ending balance (simulated)")).toBeInTheDocument();
    expect(screen.getByText(/\+4\.00R total · 1% risk per trade/)).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Simulated result of each trade" })).toBeInTheDocument();
    for (const h of screen.getAllByRole("columnheader")) expect(h).toHaveAttribute("scope", "col");
    expect(screen.getByText("Balance from $1,000.00 to $1,040.09 after 3 trades")).toHaveClass("sr-only");
    expect(container.firstElementChild).toHaveAttribute("aria-live", "polite");
  });

  it("with each trade's own risk, the sub line shows the average risk", () => {
    const own = simulateBalance([{ ...pts[0], riskPct: 1 }, { ...pts[1], riskPct: 2 }], { start: 1000, riskPct: 1, mode: "fixed", useTradeRisk: true });
    render(<BalanceResults sim={own} {...props} useTradeRisk />);
    expect(screen.getByText(/\+1\.00R total · avg 1\.5% risk/)).toBeInTheDocument();
  });

  it("fixed mode matches the hand calculation", () => {
    render(<BalanceResults sim={sim({ mode: "fixed" })} {...props} />);
    expect(screen.getAllByText("$1,040.00").length).toBeGreaterThan(0);
    expect(screen.getByText("$1,010.00")).toBeInTheDocument();
  });

  it("labels non-taken statuses as not live and shows a status column", () => {
    render(<BalanceResults sim={sim()} {...props} statuses={["skipped", "backtest"]} meta={{ ...meta, 1: { setup: "LHPB", status: "skipped" } }} />);
    expect(screen.getByText(/Not live results: this simulates Skipped, Backtest ideas/)).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
    expect(screen.queryByText(/Mixed statuses/)).not.toBeInTheDocument();
  });

  it("taken plus anything else is flagged as mixed statuses", () => {
    render(<BalanceResults sim={sim()} {...props} statuses={["taken", "forward_test"]} />);
    expect(screen.getByText(/Mixed statuses — not live results/)).toBeInTheDocument();
  });

  it("empty state instead of zeros", () => {
    render(<BalanceResults sim={simulateBalance([], { start: 1000, riskPct: 1, mode: "fixed", useTradeRisk: false })} {...props} />);
    expect(screen.getByText("No closed trades match these filters.")).toBeInTheDocument();
    expect(screen.queryByText("Ending balance (simulated)")).not.toBeInTheDocument();
  });

  it("flags ruin and the fallback to the default risk", () => {
    const ruin = simulateBalance([{ id: 1, r: -1, date: "2026-01-01" }, { id: 2, r: 1, date: "2026-01-02" }], { start: 100, riskPct: 100, mode: "compounding", useTradeRisk: false });
    const { unmount } = render(<BalanceResults sim={ruin} {...props} meta={{}} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/wiped out.*remaining 1 trade is not simulated/);
    unmount();
    const fb = simulateBalance(pts, { start: 1000, riskPct: 1, mode: "fixed", useTradeRisk: true });
    render(<BalanceResults sim={fb} {...props} useTradeRisk />);
    expect(screen.getByText(/3 trades have no recorded risk and used the 1% default/)).toBeInTheDocument();
    expect(screen.getAllByText("1% (default)")).toHaveLength(3);
  });
});
