// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
const deleteIdea = vi.fn();
vi.mock("@/lib/actions", () => ({ deleteIdea: (...a: unknown[]) => deleteIdea(...a) }));

import { IdeaActions } from "./idea-actions";

describe("IdeaActions delete", () => {
  beforeEach(() => {
    push.mockReset();
    deleteIdea.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("goes back to the journal after a successful delete", async () => {
    deleteIdea.mockResolvedValue({ ok: true });
    render(<IdeaActions id={4} />);
    await userEvent.click(screen.getByRole("button", { name: /Delete/ }));
    expect(deleteIdea).toHaveBeenCalledWith(4);
    expect(push).toHaveBeenCalledWith("/ideas");
  });

  it("stays put and shows the error when the delete fails", async () => {
    deleteIdea.mockResolvedValue({ ok: false, error: "Idea not found" });
    render(<IdeaActions id={4} />);
    await userEvent.click(screen.getByRole("button", { name: /Delete/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Idea not found");
    expect(push).not.toHaveBeenCalled();
  });
});
