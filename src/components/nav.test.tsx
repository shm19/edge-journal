// @vitest-environment jsdom
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
let path = "/ideas";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => path,
}));

import { Sidebar } from "./nav";

describe("Sidebar 'n' shortcut", () => {
  beforeEach(() => {
    push.mockClear();
    path = "/ideas";
    document.body.innerHTML = "";
  });

  it("opens a new idea from anywhere on the page", async () => {
    render(<Sidebar logout={async () => {}} />);
    await userEvent.keyboard("n");
    expect(push).toHaveBeenCalledWith("/ideas/new");
  });

  it("ignores typing inside a dialog (such as a date popover) and modified keys", async () => {
    render(<Sidebar logout={async () => {}} />);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.tabIndex = -1;
    document.body.appendChild(dialog);
    dialog.focus();
    await userEvent.keyboard("n");
    expect(push).not.toHaveBeenCalled();
    document.body.focus();
    await userEvent.keyboard("{Control>}n{/Control}");
    expect(push).not.toHaveBeenCalled();
  });

  it("is off inside an editor", async () => {
    path = "/ideas/new";
    render(<Sidebar logout={async () => {}} />);
    await userEvent.keyboard("n");
    expect(push).not.toHaveBeenCalled();
  });
});
