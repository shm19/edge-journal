// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeIdea, makeMistake, makeSetup } from "../../test/fixtures";
import { IdeaTable } from "./idea-table";

const headers = () => screen.getAllByRole("columnheader").map((h) => h.textContent);

describe("IdeaTable", () => {
  it("puts the result right after Status and hides Entry and Tags below xl, so R is never the cut-off column", () => {
    render(<IdeaTable ideas={[makeIdea()]} be={0.1} />);
    expect(headers()).toEqual(["Date", "Coin", "Setup", "Status", "R", "Entry", "R:R", "Alts", "Tags"]);
    for (const name of ["Entry", "Tags"]) {
      expect(screen.getByRole("columnheader", { name })).toHaveClass("hidden", "xl:table-cell");
    }
    for (const name of ["Date", "Coin", "Setup", "Status", "R", "R:R", "Alts"]) {
      expect(screen.getByRole("columnheader", { name })).not.toHaveClass("hidden");
    }
  });

  it("scrolls sideways instead of clipping when it is still too wide", () => {
    const { container } = render(<IdeaTable ideas={[makeIdea()]} be={0.1} />);
    expect(container.firstElementChild).toHaveClass("overflow-x-auto");
    expect(container.firstElementChild).not.toHaveClass("overflow-hidden");
  });

  it("labels the result of a skipped, missed or forward idea 'if taken', never a taken one", () => {
    render(
      <IdeaTable
        ideas={[
          makeIdea({ status: "skipped", r: 1.88 }),
          makeIdea({ status: "missed", r: 2 }),
          makeIdea({ status: "forward_test", r: 1 }),
          makeIdea({ status: "taken", r: 1.5 }),
          makeIdea({ status: "backtest", r: 1.5 }),
        ]}
        be={0.1}
      />,
    );
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).queryByText("if taken") != null)).toEqual([true, true, true, false, false]);
    expect(within(rows[0]).getByText("+1.88R")).toBeInTheDocument();
  });

  it("shows pending / open / not-filled / Hit without 'if taken' noise", () => {
    render(<IdeaTable ideas={[makeIdea({ status: "skipped", r: null }), makeIdea({ status: "forward_test", r: false, outcome: "hit" })]} be={0.1} />);
    expect(screen.queryByText("if taken")).not.toBeInTheDocument();
    expect(screen.getByText("open")).toBeInTheDocument();
    expect(screen.getByText("Hit")).toBeInTheDocument();
  });

  it("keeps the mistake pill on one line", () => {
    render(<IdeaTable ideas={[makeIdea({ setup: makeSetup({ name: "LHPB" }), mistakes: [makeMistake(), makeMistake()] })]} be={0.1} />);
    expect(screen.getByText("2 mistakes")).toHaveClass("whitespace-nowrap");
    expect(screen.getByText("LHPB")).toBeInTheDocument();
  });
});
