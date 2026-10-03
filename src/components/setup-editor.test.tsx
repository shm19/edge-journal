// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/lib/actions", () => ({ saveSetup: vi.fn(), deleteSetup: vi.fn() }));

import { SetupEditor, type SetupForm } from "./setup-editor";

const blank: SetupForm = { name: "", description: "", rules: "", checklist: [], status: "testing", defaultTimeframe: "", color: "#6366f1" };

describe("SetupEditor", () => {
  it("says why Save is disabled while the name is empty, and stops saying it once there is one", async () => {
    render(<SetupEditor initial={blank} />);
    const save = screen.getByRole("button", { name: /Save/ });
    expect(save).toBeDisabled();
    expect(screen.getByText("Give the setup a name")).toBeInTheDocument();
    expect(save).toHaveAccessibleDescription("Give the setup a name");
    await userEvent.setup().type(screen.getByPlaceholderText("e.g. LHPB retest"), "Sweep");
    expect(save).toBeEnabled();
    expect(screen.queryByText("Give the setup a name")).not.toBeInTheDocument();
  });

  it("a saved setup with a name shows no hint", () => {
    render(<SetupEditor initial={{ ...blank, id: 3, name: "LHPB" }} />);
    expect(screen.queryByText("Give the setup a name")).not.toBeInTheDocument();
  });
});
