// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { BalanceCard } from "./balance-card";

const points = [2, -1, 3].map((r, i) => ({ id: i + 1, r, date: `2026-01-0${i + 1}T00:00:00.000Z`, riskPct: null }));

describe("BalanceCard", () => {
  beforeEach(() => window.localStorage.clear());

  it("shows start → end, % and the link, with defaults when nothing is remembered", () => {
    render(<BalanceCard points={points} defaultRiskPct={1} />);
    expect(screen.getByText(/\$1,000\.00 → \$1,040\.09/)).toBeInTheDocument();
    expect(screen.getByText("(+4.01%)")).toBeInTheDocument();
    expect(screen.getByText(/n=3 · too few to trust/)).toBeInTheDocument();
    expect(screen.getByText(/Hypothetical, not your account · all time, taken trades \(ignores the 7D\/30D selector\) · your last simulator settings/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Simulate/ })).toHaveAttribute("href", "/analytics?tab=balance&start=1000&risk=1&mode=compounding&fee=0");
  });

  it("uses the remembered inputs", () => {
    window.localStorage.setItem("edge-journal.balance-inputs", "start=1000&risk=1&mode=fixed&fee=0");
    render(<BalanceCard points={points} defaultRiskPct={1} />);
    expect(screen.getByText(/→ \$1,040\.00/)).toBeInTheDocument();
    expect(screen.getByText(/fixed/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Simulate/ })).toHaveAttribute("href", expect.stringContaining("mode=fixed"));
  });

  it("ignores remembered inputs that no longer validate, and says when each trade's own risk is used", () => {
    window.localStorage.setItem("edge-journal.balance-inputs", "start=0");
    const { unmount } = render(<BalanceCard points={points} defaultRiskPct={1} />);
    expect(screen.getByText(/\$1,000\.00 → /)).toBeInTheDocument();
    unmount();
    window.localStorage.setItem("edge-journal.balance-inputs", "start=1000&risk=1&mode=fixed&trade=1");
    render(<BalanceCard points={points} defaultRiskPct={1} />);
    expect(screen.getByText(/each trade's own risk/)).toBeInTheDocument();
  });

  it("empty state, and a negative result is shown as a loss", () => {
    const { unmount } = render(<BalanceCard points={[]} defaultRiskPct={1} />);
    expect(screen.getByText("No closed taken trades yet")).toBeInTheDocument();
    unmount();
    window.localStorage.setItem("edge-journal.balance-inputs", "start=100&risk=100&mode=compounding&fee=0");
    render(<BalanceCard points={[{ id: 1, r: -1, date: "2026-01-01" }]} defaultRiskPct={1} />);
    expect(screen.getByText("(-100.00%)")).toBeInTheDocument();
    expect(screen.getByText(/account wiped out/)).toBeInTheDocument();
  });
});
