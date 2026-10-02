// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { summarize } from "@/lib/stats";
import { BreakdownList } from "./breakdown-list";

const pts = (rs: number[]) => rs.map((r, i) => ({ id: i + 1, r, date: `2026-09-${String(i + 1).padStart(2, "0")}` }));

describe("BreakdownList", () => {
  const rows = [
    { key: "LHPB", summary: summarize(pts([2, -1, 1])) }, // n=3, 2 wins, total +2, expectancy +0.67
    { key: "No tag", label: <em>custom label</em>, summary: summarize(pts([-1])) },
  ];

  it("shows label, n, win rate and the chosen R value per row", () => {
    render(<BreakdownList rows={rows} value="totalR" empty="nothing" />);
    const first = screen.getAllByRole("listitem")[0];
    expect(within(first).getByText("LHPB")).toBeInTheDocument();
    expect(within(first).getByText("n=3")).toBeInTheDocument();
    expect(within(first).getByText("67%")).toBeInTheDocument();
    expect(within(first).getByText("+2.00R")).toBeInTheDocument();
  });

  it("switches between total and expectancy", () => {
    render(<BreakdownList rows={rows} value="expectancy" empty="nothing" />);
    expect(screen.getByText("+0.67R")).toBeInTheDocument();
    expect(screen.queryByText("+2.00R")).not.toBeInTheDocument();
  });

  it("renders a custom label instead of the key", () => {
    render(<BreakdownList rows={rows} value="totalR" empty="nothing" />);
    expect(screen.getByText("custom label")).toBeInTheDocument();
    expect(screen.queryByText("No tag")).not.toBeInTheDocument();
  });

  it("shows the empty message when there are no rows", () => {
    render(<BreakdownList rows={[]} value="totalR" empty="No closed trades yet." />);
    expect(screen.getByText("No closed trades yet.")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });
});
