// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { chooseOption } from "../../test/select";
import { TypePicker } from "./type-picker";

const types = [
  { id: 1, name: "BE stop", description: "Move the stop to entry" },
  { id: 2, name: "Hold to target", description: "" },
];

function setup(over: Partial<React.ComponentProps<typeof TypePicker>> = {}) {
  const onPick = vi.fn();
  const onCreate = vi.fn(async (name: string) => ({ ok: true as const, id: 99 + name.length }));
  render(
    <TypePicker label="Add an alternative" types={types} quick={[1, 2]} onPick={onPick} onCreate={onCreate} createPlaceholder="e.g. New thing" {...over} />,
  );
  return { onPick, onCreate, user: userEvent.setup() };
}

describe("TypePicker", () => {
  it("picks a saved type from a quick chip", async () => {
    const { onPick, user } = setup();
    await user.click(screen.getByRole("button", { name: "Add Hold to target" }));
    expect(onPick).toHaveBeenCalledWith(2);
  });

  it("picks a saved type from the dropdown", async () => {
    const { onPick, user } = setup();
    await chooseOption(user, "Add an alternative: choose a saved type", /^BE stop/);
    expect(onPick).toHaveBeenCalledWith(1);
  });

  it("creates a new type, then picks it", async () => {
    const { onPick, onCreate, user } = setup();
    await user.click(screen.getByRole("button", { name: /New type/ }));
    await user.type(screen.getByLabelText("New type name"), "Wick entry");
    await user.type(screen.getByLabelText("New type description"), "Limit at the wick");
    await user.click(screen.getByRole("button", { name: /Create & add/ }));
    expect(onCreate).toHaveBeenCalledWith("Wick entry", "Limit at the wick");
    await waitFor(() => expect(onPick).toHaveBeenCalledWith(99 + "Wick entry".length));
    expect(screen.queryByLabelText("New type name")).not.toBeInTheDocument(); // form closed
  });

  it("reuses an existing type with the same name (case-insensitive) instead of creating a duplicate", async () => {
    const { onPick, onCreate, user } = setup();
    await user.click(screen.getByRole("button", { name: /New type/ }));
    await user.type(screen.getByLabelText("New type name"), "be STOP{Enter}");
    expect(onCreate).not.toHaveBeenCalled();
    expect(onPick).toHaveBeenCalledWith(1);
  });

  it("shows the error and keeps the form when creating fails", async () => {
    const onCreate = vi.fn(async () => ({ ok: false as const, error: "Name too long" }));
    const { onPick, user } = setup({ onCreate });
    await user.click(screen.getByRole("button", { name: /New type/ }));
    await user.type(screen.getByLabelText("New type name"), "Whatever");
    await user.click(screen.getByRole("button", { name: /Create & add/ }));
    expect(await screen.findByText("Name too long")).toBeInTheDocument();
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByLabelText("New type name")).toHaveValue("Whatever");
  });

  it("disables Create until there is a name", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /New type/ }));
    expect(screen.getByRole("button", { name: /Create & add/ })).toBeDisabled();
  });
});
