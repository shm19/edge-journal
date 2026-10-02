// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/analytics",
  useSearchParams: () => new URLSearchParams(search),
}));

import { FilterBar } from "./filter-bar";

const props = { setups: [{ id: 1, name: "LHPB" }], tags: [], symbols: ["BTC"] };

describe("FilterBar Clear", () => {
  beforeEach(() => replace.mockClear());

  it("is hidden when no filter is active", () => {
    search = "group=tag&tab=skips"; // view settings are not filters
    render(<FilterBar {...props} />);
    expect(screen.queryByRole("button", { name: /Clear/ })).not.toBeInTheDocument();
  });

  it("drops every filter but keeps group, metric and tab", async () => {
    search = "status=taken&setup=1&symbol=BTC&q=wick&group=tag&metric=totalR&tab=breakdown";
    render(<FilterBar {...props} />);
    await userEvent.click(screen.getByRole("button", { name: /Clear/ }));
    expect(replace).toHaveBeenCalledWith("/analytics?group=tag&metric=totalR&tab=breakdown", { scroll: false });
  });

  it("goes to the bare path when nothing needs keeping", async () => {
    search = "setup=1";
    render(<FilterBar {...props} />);
    await userEvent.click(screen.getByRole("button", { name: /Clear/ }));
    expect(replace).toHaveBeenCalledWith("/analytics", { scroll: false });
  });

  it("clears the search box too", async () => {
    search = "q=wick";
    render(<FilterBar {...props} />);
    const box = screen.getByPlaceholderText("Search notes…");
    expect(box).toHaveValue("wick");
    await userEvent.click(screen.getByRole("button", { name: /Clear/ }));
    expect(box).toHaveValue("");
  });
});
