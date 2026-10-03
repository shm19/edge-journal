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

describe("FilterBar date range", () => {
  beforeEach(() => replace.mockClear());

  it("is accented only when a from / to is set", () => {
    search = "";
    const { unmount } = render(<FilterBar {...props} />);
    expect(screen.getByRole("button", { name: "Date range, Any date" }).className).not.toContain("border-accent/50");
    unmount();
    search = "from=2026-10-01&to=2026-10-02";
    render(<FilterBar {...props} />);
    expect(screen.getByRole("button", { name: "Date range, 2026-10-01 → 2026-10-02" }).className).toContain("border-accent/50");
  });

  it("shows a hand-edited inverted or junk range the way the server reads it", () => {
    search = "from=2026-10-09&to=2026-10-01";
    const { unmount } = render(<FilterBar {...props} />);
    expect(screen.getByRole("button", { name: "Date range, 2026-10-01 → 2026-10-09" })).toBeInTheDocument();
    unmount();
    search = "from=junk&to=2026-02-30";
    render(<FilterBar {...props} />);
    expect(screen.getByRole("button", { name: "Date range, Any date" })).toBeInTheDocument();
  });

  it("writes a typed From as a YYYY-MM-DD URL param", async () => {
    search = "";
    window.history.replaceState(null, "", "/analytics");
    render(<FilterBar {...props} />);
    await userEvent.click(screen.getByRole("button", { name: /^Date range/ }));
    await userEvent.type(screen.getByLabelText("From (UTC)"), "2026-10-01");
    expect(replace).toHaveBeenLastCalledWith("/analytics?from=2026-10-01", { scroll: false });
  });
});
