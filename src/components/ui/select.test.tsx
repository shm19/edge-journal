// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Select } from "./select";

const few = ["Alpha", "Beta", "H1", "H4", "Gamma"];
const many = ["Apple", "Banana", "Cherry", "Date", "Elder", "Fig", "Grape", "Honey", "Iris", "Juniper"];

function setup(props: Partial<React.ComponentProps<typeof Select>> = {}, options: string[] = few) {
  const onChange = vi.fn();
  const utils = render(
    <Select value="Beta" onChange={onChange} aria-label="Pick" {...props}>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </Select>,
  );
  return { onChange, user: userEvent.setup(), trigger: screen.getByLabelText("Pick"), ...utils };
}

const highlighted = () => screen.getByRole("option", { selected: true });

describe("Select", () => {
  it("is a combobox whose aria-expanded flips on open and close", async () => {
    const { user, trigger } = setup();
    expect(trigger).toHaveAttribute("role", "combobox");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: "Pick" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("ArrowDown opens on the selected option, ArrowDown+Enter picks the next one", async () => {
    const { user, trigger, onChange } = setup();
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    expect(highlighted()).toHaveTextContent("Beta");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ target: { value: "H1" } });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("Escape closes without picking and returns focus to the trigger", async () => {
    const { user, trigger, onChange } = setup();
    await user.click(trigger);
    await user.keyboard("{ArrowDown}{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("filters by label with 9+ options and shows No matches for garbage", async () => {
    const { user, trigger } = setup({ value: "Apple" }, many);
    await user.click(trigger);
    expect(screen.getByRole("combobox", { name: "Search options" })).toBeInTheDocument();
    await user.keyboard("an");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Banana"]);
    await user.keyboard("zzz");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("No matches")).toBeInTheDocument();
  });

  it("does not match digits in the search against the hidden index", async () => {
    const { user, trigger } = setup({ value: "Apple" }, many);
    await user.click(trigger);
    await user.keyboard("1");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("No matches")).toBeInTheDocument();
  });

  it("type-ahead on a short list jumps to the first option starting with the text", async () => {
    const { user, trigger, onChange } = setup();
    expect(screen.queryByPlaceholderText("Search…")).not.toBeInTheDocument();
    await user.click(trigger);
    expect(screen.getByRole("combobox", { name: "Type to jump to an option" })).toBeInTheDocument();
    await user.keyboard("g");
    expect(highlighted()).toHaveTextContent("Gamma");
    expect(screen.getAllByRole("option")).toHaveLength(few.length);
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith({ target: { value: "Gamma" } });
  });

  it("cannot pick a disabled option and skips it for the initial highlight", async () => {
    const onChange = vi.fn();
    render(
      <Select value="zzz" onChange={onChange} aria-label="Pick">
        <option value="a" disabled>
          Off
        </option>
        <option value="b">On</option>
      </Select>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Pick"));
    expect(highlighted()).toHaveTextContent("On");
    await user.click(screen.getByRole("option", { name: "Off" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("renders optgroup headings", async () => {
    const user = userEvent.setup();
    render(
      <Select value="" onChange={() => {}} aria-label="Grouped">
        <option value="">Any tag</option>
        <optgroup label="Session">
          <option value="1">Asia</option>
        </optgroup>
        <optgroup label="Trend">
          <option value="2">Up</option>
        </optgroup>
      </Select>,
    );
    await user.click(screen.getByLabelText("Grouped"));
    expect(screen.getByText("Session")).toBeInTheDocument();
    expect(screen.getByText("Trend")).toBeInTheDocument();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Any tag", "Asia", "Up"]);
  });

  it("renders a hidden input for name, and disables it with the select", () => {
    const { container, rerender, onChange } = setup({ name: "tf" });
    const input = () => container.querySelector<HTMLInputElement>('input[type="hidden"][name="tf"]')!;
    expect(input().value).toBe("Beta");
    expect(input()).not.toBeDisabled();
    rerender(
      <Select value="H4" onChange={onChange} name="tf" disabled aria-label="Pick">
        <option value="H4">H4</option>
      </Select>,
    );
    expect(input().value).toBe("H4");
    expect(input()).toBeDisabled();
    expect(screen.getByLabelText("Pick")).toBeDisabled();
  });

  it("default-prevents Cmd/Ctrl+Enter and picks nothing", async () => {
    const { user, trigger, onChange } = setup();
    await user.click(trigger);
    const input = screen.getByRole("combobox", { name: "Type to jump to an option" });
    for (const mod of [{ metaKey: true }, { ctrlKey: true }]) {
      // fireEvent returns false when the event was default-prevented
      expect(fireEvent.keyDown(input, { key: "Enter", ...mod })).toBe(false);
    }
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("does not call onChange when the current value is picked again", async () => {
    const { user, trigger, onChange } = setup();
    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: /Beta/ }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("passes { target: { value } } to onChange", async () => {
    const { user, trigger, onChange } = setup();
    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "H4" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ target: { value: "H4" } });
  });

  it("shows a placeholder when the value matches no option", () => {
    const { trigger } = setup({ value: "gone" });
    expect(trigger).toHaveTextContent("Select…");
    expect(trigger.firstElementChild).toHaveClass("text-muted");
  });

  it("marks the current option, but not the empty-value option", async () => {
    const { user, trigger } = setup();
    await user.click(trigger);
    expect(screen.getByRole("option", { name: /Beta/ })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("option", { name: "Beta (selected)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Alpha" })).not.toHaveAttribute("aria-current");
    await user.keyboard("{Escape}");

    render(
      <Select value="" onChange={() => {}} aria-label="Any">
        <option value="">All setups</option>
        <option value="1">One</option>
      </Select>,
    );
    await user.click(screen.getByLabelText("Any"));
    const all = screen.getByRole("option", { name: "All setups" });
    expect(all.querySelector("svg")).toBeNull();
    expect(all).not.toHaveTextContent("selected");
  });

  it("Tab inside the list commits nothing, closes it and leaves focus on the trigger", async () => {
    const { user, trigger, onChange } = setup();
    await user.click(trigger);
    await user.keyboard("{ArrowDown}{Tab}");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("a printable key on the closed trigger opens the list and seeds type-ahead", async () => {
    const { user, trigger, onChange } = setup();
    trigger.focus();
    await user.keyboard("H1");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(highlighted()).toHaveTextContent("H1");
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith({ target: { value: "H1" } });
  });

  it("a printable key seeds the search on a long list", async () => {
    const { user, trigger } = setup({ value: "Apple" }, many);
    trigger.focus();
    await user.keyboard("ju");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Juniper"]);
  });

  it("modified keys on the closed trigger do not open it", async () => {
    const { user, trigger } = setup();
    trigger.focus();
    await user.keyboard("{Control>}a{/Control}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("calls the caller's onKeyDown first and respects preventDefault", async () => {
    const onKeyDown = vi.fn((e: React.KeyboardEvent) => e.preventDefault());
    const { user, trigger } = setup({ onKeyDown });
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    expect(onKeyDown).toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
