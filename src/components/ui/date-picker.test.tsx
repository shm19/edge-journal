// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DateRangePicker, DateTimeField } from "./date-picker";

// A Friday; 23:30 UTC so a local-time implementation in a UTC+ zone would already be on the 3rd.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-02T23:30:00Z"));
});
afterEach(() => vi.useRealTimers());

const day = (name: string) => screen.getByRole("button", { name });

function setupField(props: Partial<React.ComponentProps<typeof DateTimeField>> = {}) {
  const onChange = vi.fn();
  const utils = render(<DateTimeField id="f" label="Opened (UTC)" value="2026-10-02T14:30" onChange={onChange} {...props} />);
  return { onChange, user: userEvent.setup(), input: screen.getByLabelText("Opened (UTC)") as HTMLInputElement, ...utils };
}
const openField = async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("button", { name: "Open calendar for Opened (UTC)" }));

describe("DateTimeField", () => {
  it("shows the value as typed text", () => {
    const { input } = setupField();
    expect(input).toHaveValue("2026-10-02 14:30");
  });

  it("opens a dialog with the month, today marked, and the selected day; Escape closes and returns focus", async () => {
    const { user } = setupField({ value: "2026-10-09T08:00" });
    const trigger = screen.getByRole("button", { name: "Open calendar for Opened (UTC)" });
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "Opened (UTC) calendar" })).toBeInTheDocument();
    expect(screen.getByText("October 2026")).toBeInTheDocument();
    expect(day("2 October 2026, Friday")).toHaveAttribute("aria-current", "date"); // today, in UTC
    expect(day("9 October 2026, Friday").closest("td")).toHaveAttribute("aria-selected", "true");
    expect(day("9 October 2026, Friday")).toHaveFocus();
    expect(screen.getByRole("grid")).toHaveAccessibleName("October 2026");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("picking a day keeps the time and reports the value string", async () => {
    const { user, onChange, input } = setupField();
    await openField(user);
    await user.click(day("20 October 2026, Tuesday"));
    expect(onChange).toHaveBeenLastCalledWith("2026-10-20T14:30");
    expect(input).toHaveValue("2026-10-20 14:30");
  });

  it("picking a day on an empty field starts at 00:00", async () => {
    const { user, onChange } = setupField({ value: "" });
    await openField(user);
    await user.click(day("2 October 2026, Friday"));
    expect(onChange).toHaveBeenLastCalledWith("2026-10-02T00:00");
  });

  it("navigates months with the buttons and across a year end", async () => {
    const { user } = setupField({ value: "2026-12-15T10:00" });
    await openField(user);
    await user.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByText("January 2027")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByText("November 2026")).toBeInTheDocument();
  });

  it("moves the focused day with the arrow keys, Home/End and PageUp/PageDown, and Enter picks", async () => {
    const { user, onChange } = setupField({ value: "2026-10-01T10:00" }); // a Thursday
    await openField(user);
    await user.keyboard("{ArrowRight}");
    expect(day("2 October 2026, Friday")).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(day("9 October 2026, Friday")).toHaveFocus();
    await user.keyboard("{ArrowLeft}{ArrowUp}");
    expect(day("1 October 2026, Thursday")).toHaveFocus();
    await user.keyboard("{Home}");
    expect(day("28 September 2026, Monday")).toHaveFocus();
    await user.keyboard("{End}");
    expect(day("4 October 2026, Sunday")).toHaveFocus();
    await user.keyboard("{PageDown}");
    expect(screen.getByText("November 2026")).toBeInTheDocument();
    expect(day("4 November 2026, Wednesday")).toHaveFocus();
    await user.keyboard("{Shift>}{PageUp}{/Shift}");
    expect(screen.getByText("November 2025")).toBeInTheDocument();
    await user.keyboard("{PageUp}");
    expect(screen.getByText("October 2025")).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("2025-10-04T10:00");
  });

  it("clamps PageDown from the 31st to a short month", async () => {
    const { user } = setupField({ value: "2028-01-31T10:00" });
    await openField(user);
    await user.keyboard("{PageDown}");
    expect(day("29 February 2028, Tuesday")).toHaveFocus(); // leap year
  });

  it("ignores other keys and modified arrows", async () => {
    const { user } = setupField();
    await openField(user);
    await user.keyboard("a{Control>}{ArrowRight}{/Control}");
    expect(day("2 October 2026, Friday")).toHaveFocus();
  });

  it("accepts a typed value (space or T) and reports it", async () => {
    const { user, onChange, input } = setupField({ value: "" });
    await user.type(input, "2026-10-02 14:30");
    expect(onChange).toHaveBeenLastCalledWith("2026-10-02T14:30");
    expect(screen.queryByText(/Use YYYY-MM-DD HH:mm/)).not.toBeInTheDocument();
  });

  it("keeps an invalid text visible with an inline error and never reports it", async () => {
    const { user, onChange, input } = setupField({ value: "" });
    await user.type(input, "2026-02-30 10:00");
    // Partial dates ("2026-02-3") are valid date-only entries on the way, but the invalid whole is never reported.
    expect(onChange).not.toHaveBeenCalledWith(expect.stringContaining("2026-02-30"));
    expect(onChange).not.toHaveBeenLastCalledWith("2026-02-30T10:00");
    expect(input).toHaveValue("2026-02-30 10:00");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Use YYYY-MM-DD HH:mm (24h, UTC).")).toHaveAttribute("id", input.getAttribute("aria-describedby"));
  });

  it("clearing the text reports an empty value, or errors when required", async () => {
    const a = setupField();
    await a.user.clear(a.input);
    expect(a.onChange).toHaveBeenLastCalledWith("");
    a.unmount();
    const b = setupField({ required: true });
    await b.user.clear(b.input);
    expect(b.onChange).not.toHaveBeenCalled();
    expect(b.input).toHaveAttribute("aria-invalid", "false"); // not yet: the user may still be typing
    await b.user.tab();
    expect(b.input).toHaveAttribute("aria-invalid", "true");
  });

  it("follows the value when it changes from outside, but not while the draft already matches", () => {
    const { input, rerender, onChange } = setupField();
    rerender(<DateTimeField id="f" label="Opened (UTC)" value="2026-11-01T09:00" onChange={onChange} />);
    expect(input).toHaveValue("2026-11-01 09:00");
  });

  it("does not rewrite the text while typing a value that normalises", async () => {
    const onChange = vi.fn();
    const Host = () => {
      const [v, setV] = useState("");
      return <DateTimeField id="f" label="Opened (UTC)" value={v} onChange={(x) => {
          setV(x);
          onChange(x);
        }} />;
    };
    const user = userEvent.setup();
    render(<Host />);
    const input = screen.getByLabelText("Opened (UTC)");
    await user.type(input, "2026-1-5 9:05");
    expect(input).toHaveValue("2026-1-5 9:05");
    expect(onChange).toHaveBeenLastCalledWith("2026-01-05T09:05");
  });

  describe("time box", () => {
    it("commits a valid time on the same date, round-tripping near midnight", async () => {
      const { user, onChange } = setupField({ value: "2026-12-31T10:00" });
      await openField(user);
      const time = screen.getByLabelText("Time (UTC)");
      await user.clear(time);
      await user.type(time, "23:59");
      expect(onChange).toHaveBeenLastCalledWith("2026-12-31T23:59");
      await user.clear(time);
      await user.type(time, "0:00");
      expect(onChange).toHaveBeenLastCalledWith("2026-12-31T00:00");
    });

    it("shows an error for an invalid time and does not commit it", async () => {
      const { user, onChange } = setupField();
      await openField(user);
      const time = screen.getByLabelText("Time (UTC)");
      await user.clear(time);
      await user.type(time, "24:00");
      expect(time).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByText("Use 24h HH:mm.")).toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
      await user.type(time, "{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}");
      expect(screen.getByText("Use 24h HH:mm.")).toBeInTheDocument(); // empty with a date is invalid too
    });

    it("an empty field with no date takes today (UTC) when a time is typed", async () => {
      const { user, onChange } = setupField({ value: "" });
      await openField(user);
      expect(screen.queryByText("Use 24h HH:mm.")).not.toBeInTheDocument();
      await user.type(screen.getByLabelText("Time (UTC)"), "08:15");
      expect(onChange).toHaveBeenLastCalledWith("2026-10-02T08:15");
    });

    it("picking a day while the time is invalid keeps the last good time", async () => {
      const { user, onChange } = setupField();
      await openField(user);
      await user.type(screen.getByLabelText("Time (UTC)"), "9");
      await user.click(day("3 October 2026, Saturday"));
      expect(onChange).toHaveBeenLastCalledWith("2026-10-03T14:30");
    });
  });

  it("Now sets the current UTC minute and closes", async () => {
    const { user, onChange, input } = setupField();
    await openField(user);
    await user.click(screen.getByRole("button", { name: "Now" }));
    expect(onChange).toHaveBeenLastCalledWith("2026-10-02T23:30");
    expect(input).toHaveValue("2026-10-02 23:30");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Clear exists only when clearable, empties the value and the invalid text, and closes", async () => {
    const a = setupField();
    await openField(a.user);
    expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
    a.unmount();
    const { user, onChange, input } = setupField({ clearable: true });
    await user.type(input, "x");
    await openField(user);
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenLastCalledWith("");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Done closes", async () => {
    const { user } = setupField();
    await openField(user);
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders a hint", () => {
    setupField({ hint: "Set to the open time" });
    expect(screen.getByText("Set to the open time")).toBeInTheDocument();
  });
});

function setupRange(from = "", to = "") {
  const onChange = vi.fn();
  const utils = render(<DateRangePicker from={from} to={to} onChange={onChange} />);
  return { onChange, user: userEvent.setup(), ...utils };
}
const trigger = () => screen.getByRole("button", { name: /^Date range/ });

describe("DateRangePicker", () => {
  it("summarises the range on the trigger and accents it only when active", () => {
    const a = setupRange();
    expect(trigger()).toHaveAccessibleName("Date range, Any date");
    expect(trigger().className).not.toContain("text-accent");
    a.unmount();
    const b = setupRange("2026-10-01", "2026-10-02");
    expect(trigger()).toHaveAccessibleName("Date range, 2026-10-01 → 2026-10-02");
    expect(trigger().className).toContain("border-accent/50");
    b.unmount();
    setupRange("2026-10-01", "2026-10-01");
    expect(trigger()).toHaveAccessibleName("Date range, 2026-10-01");
  });

  it("describes open-ended ranges", () => {
    const a = setupRange("2026-10-01", "");
    expect(trigger()).toHaveAccessibleName("Date range, From 2026-10-01");
    a.unmount();
    setupRange("", "2026-10-05");
    expect(trigger()).toHaveAccessibleName("Date range, Until 2026-10-05");
  });

  it("applies each preset in UTC and closes", async () => {
    const expected: Record<string, [string, string]> = {
      Today: ["2026-10-02", "2026-10-02"],
      Yesterday: ["2026-10-01", "2026-10-01"],
      "This week": ["2026-09-28", "2026-10-02"],
      "Last 7 days": ["2026-09-26", "2026-10-02"],
      "Last 30 days": ["2026-09-03", "2026-10-02"],
      "This month": ["2026-10-01", "2026-10-02"],
    };
    for (const [name, range] of Object.entries(expected)) {
      const { user, onChange, unmount } = setupRange();
      await user.click(trigger());
      await user.click(screen.getByRole("button", { name }));
      expect(onChange, name).toHaveBeenLastCalledWith(...range);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      unmount();
    }
  });

  it("clicking two days sets the range, in order even when clicked backwards", async () => {
    const { user, onChange } = setupRange();
    await user.click(trigger());
    await user.click(day("9 October 2026, Friday"));
    expect(onChange).toHaveBeenLastCalledWith("2026-10-09", "");
    await user.click(day("5 October 2026, Monday"));
    expect(onChange).toHaveBeenLastCalledWith("2026-10-05", "2026-10-09");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); // the end click closes the popover
    await user.click(trigger());
    await user.click(day("6 October 2026, Tuesday")); // a new pick starts over
    expect(onChange).toHaveBeenLastCalledWith("2026-10-06", "");
  });

  it("highlights the selected range in the grid", async () => {
    const { user } = setupRange("2026-10-05", "2026-10-07");
    await user.click(trigger());
    for (const d of ["5 October 2026, Monday", "6 October 2026, Tuesday", "7 October 2026, Wednesday"])
      expect(day(d).closest("td")).toHaveAttribute("aria-selected", "true");
    expect(day("8 October 2026, Thursday").closest("td")).toHaveAttribute("aria-selected", "false");
  });

  it("shows a to-only range in the grid", async () => {
    const { user } = setupRange("", "2026-10-07");
    await user.click(trigger());
    expect(day("7 October 2026, Wednesday").closest("td")).toHaveAttribute("aria-selected", "true");
  });

  it("accepts typed dates and reports them", async () => {
    const { user, onChange } = setupRange();
    await user.click(trigger());
    await user.type(screen.getByLabelText("From (UTC)"), "2026-10-01");
    expect(onChange).toHaveBeenLastCalledWith("2026-10-01", "");
    await user.type(screen.getByLabelText("To (UTC)"), "2026-10-02");
    expect(onChange).toHaveBeenLastCalledWith("2026-10-01", "2026-10-02");
  });

  it("shows format and order errors and does not report them", async () => {
    const { user, onChange } = setupRange("2026-10-05", "");
    await user.click(trigger());
    const from = screen.getByLabelText("From (UTC)");
    await user.clear(from);
    await user.type(from, "2026-13-01");
    expect(screen.getByText("Use YYYY-MM-DD (UTC).")).toBeInTheDocument();
    expect(from).toHaveAttribute("aria-invalid", "true");
    await user.type(screen.getByLabelText("To (UTC)"), "nope");
    expect(screen.getAllByText("Use YYYY-MM-DD (UTC).")).toHaveLength(2);
    onChange.mockClear();
    await user.clear(from);
    await user.clear(screen.getByLabelText("To (UTC)"));
    await user.type(from, "2026-10-09");
    await user.type(screen.getByLabelText("To (UTC)"), "2026-10-01");
    expect(screen.getByText("From must not be after To.")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalledWith("2026-10-09", "2026-10-01");
  });

  it("clearing a typed end reports an open end", async () => {
    const { user, onChange } = setupRange("2026-10-05", "2026-10-07");
    await user.click(trigger());
    await user.clear(screen.getByLabelText("To (UTC)"));
    expect(onChange).toHaveBeenLastCalledWith("2026-10-05", "");
  });

  it("Clear empties both ends and closes; Done closes; Escape returns focus to the trigger", async () => {
    const { user, onChange } = setupRange("2026-10-05", "2026-10-07");
    await user.click(trigger());
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenLastCalledWith("", "");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(trigger());
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(trigger());
    await user.keyboard("{Escape}");
    expect(trigger()).toHaveFocus();
  });
});

describe("DateRangePicker anchor, presets and calendar sync", () => {
  it("forgets a half-made range when the popover closes", async () => {
    const { user, onChange } = setupRange();
    await user.click(trigger());
    await user.click(day("9 October 2026, Friday"));
    await user.keyboard("{Escape}");
    await user.click(trigger());
    await user.click(day("5 October 2026, Monday"));
    expect(onChange).toHaveBeenLastCalledWith("2026-10-05", ""); // a fresh start, not 05 → 09
  });

  it("forgets a half-made range when a date is typed", async () => {
    const { user, onChange } = setupRange();
    await user.click(trigger());
    await user.click(day("9 October 2026, Friday"));
    await user.type(screen.getByLabelText("To (UTC)"), "2026-10-20");
    await user.click(day("5 October 2026, Monday"));
    expect(onChange).toHaveBeenLastCalledWith("2026-10-05", "");
  });

  it("forgets a half-made range when a preset or Clear finishes", async () => {
    const { user, onChange } = setupRange();
    await user.click(trigger());
    await user.click(day("9 October 2026, Friday"));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Clear" }));
    await user.click(trigger());
    await user.click(day("5 October 2026, Monday"));
    expect(onChange).toHaveBeenLastCalledWith("2026-10-05", "");
  });

  it("puts Yesterday second and highlights the preset the range equals", async () => {
    const { user } = setupRange("2026-10-01", "2026-10-01");
    await user.click(trigger());
    const presets = within(screen.getByRole("dialog")).getAllByRole("button").slice(0, 3);
    expect(presets.map((b) => b.textContent)).toEqual(["Today", "Yesterday", "This week"]);
    expect(screen.getByRole("button", { name: "Yesterday" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Today" })).toHaveAttribute("aria-pressed", "false");
  });

  it("typing a date jumps the calendar to its month, but picking never re-keys it", async () => {
    const Host = () => {
      const [r, setR] = useState<[string, string]>(["", ""]);
      return <DateRangePicker from={r[0]} to={r[1]} onChange={(f, t) => setR([f, t])} />;
    };
    const user = userEvent.setup();
    render(<Host />);
    await user.click(trigger());
    await user.type(screen.getByLabelText("From (UTC)"), "2027-03-05");
    expect(screen.getByText("March 2027")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next month" }));
    await user.click(day("10 April 2027, Saturday"));
    expect(screen.getByText("April 2027")).toBeInTheDocument(); // picked a day: the month stays where the user is
    await user.type(screen.getByLabelText("To (UTC)"), "2028-01-02");
    expect(screen.getByText("January 2028")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("To (UTC)")); // only From is left: jump to its month
    expect(screen.getByText("April 2027")).toBeInTheDocument();
  });

  it("From after To shows the error on From and is not applied", async () => {
    const { user, onChange } = setupRange("", "2026-10-01");
    await user.click(trigger());
    await user.type(screen.getByLabelText("From (UTC)"), "2026-10-09");
    expect(screen.getByRole("alert")).toHaveTextContent("From must not be after To.");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Cmd/Ctrl+Enter on a day does not pick it (the editor's save shortcut owns it)", async () => {
    const { user, onChange } = setupRange();
    await user.click(trigger());
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(onChange).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("DateTimeField error from outside", () => {
  it("shows the message of a failed save under the box, marks it invalid and links it", () => {
    const { input } = setupField({ error: "Close time is before open time" });
    expect(screen.getByRole("alert")).toHaveTextContent("Close time is before open time");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toBe("f-error");
  });
  it("shows nothing for a valid box without an error", () => {
    const { input } = setupField();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "false");
  });
});

describe("DateTimeField typing, shortcuts and a11y", () => {
  it("shows the format error only on blur or at full length", async () => {
    const { user, input } = setupField({ value: "" });
    await user.type(input, "2026-10");
    expect(input).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.tab();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Use YYYY-MM-DD HH:mm");
    await user.type(input, "-02"); // typing again hides it until blur or full length
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.type(input, " 25:00");
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("accepts a time alone (keeps the date), spelled out on blur", async () => {
    const { user, input, onChange } = setupField();
    await user.clear(input);
    onChange.mockClear();
    await user.paste("9:05");
    expect(onChange).toHaveBeenLastCalledWith("2026-10-02T09:05");
    await user.tab();
    expect(input).toHaveValue("2026-10-02 09:05");
  });

  it("a date alone keeps the existing time", async () => {
    const { user, input, onChange } = setupField();
    await user.click(input);
    await user.paste("2026-11-05"); // appended to the text: invalid
    expect(onChange).not.toHaveBeenCalled();
    await user.clear(input);
    await user.paste("2026-11-05");
    expect(onChange).toHaveBeenLastCalledWith("2026-11-05T14:30");
  });

  it("accepts a pasted ISO string, lowercase t and a non-breaking space", async () => {
    const { user, input, onChange } = setupField({ value: "" });
    await user.click(input);
    await user.paste("2026-10-02T14:30:00Z");
    expect(onChange).toHaveBeenLastCalledWith("2026-10-02T14:30");
    await user.clear(input);
    await user.paste("2026-10-03t08:15");
    expect(onChange).toHaveBeenLastCalledWith("2026-10-03T08:15");
    await user.clear(input);
    await user.paste("2026-10-04\u00a009:45");
    expect(onChange).toHaveBeenLastCalledWith("2026-10-04T09:45");
  });

  it("reports invalid text through onInvalidChange, including a required empty box", async () => {
    const onInvalidChange = vi.fn();
    const { user, input } = setupField({ value: "", required: true, onInvalidChange });
    expect(onInvalidChange).toHaveBeenLastCalledWith(true);
    await user.type(input, "2026-10-02 14:30");
    expect(onInvalidChange).toHaveBeenLastCalledWith(false);
    await user.clear(input);
    await user.type(input, "2026-02-30 10:00");
    expect(onInvalidChange).toHaveBeenLastCalledWith(true);
  });

  it("links the hint with aria-describedby, next to the error when both show", async () => {
    const { user, input } = setupField({ value: "", hint: "Set to the open time" });
    expect(screen.getByText("Set to the open time")).toHaveAttribute("id", "f-hint");
    expect(input).toHaveAttribute("aria-describedby", "f-hint");
    await user.type(input, "2026-02-30 10:00");
    expect(input.getAttribute("aria-describedby")).toBe("f-error f-hint");
  });

  it("time box errors are alerts; Enter in the time box closes; Cmd/Ctrl+Enter does not", async () => {
    const { user } = setupField();
    await openField(user);
    const time = screen.getByLabelText("Time (UTC)");
    await user.clear(time);
    await user.type(time, "99");
    expect(screen.getByRole("alert")).toHaveTextContent("Use 24h HH:mm.");
    await user.type(time, "{Meta>}{Enter}{/Meta}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.type(time, "{Enter}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Cmd/Ctrl+Enter inside the popover does not activate the focused day, and still reaches the window", async () => {
    const { user, onChange } = setupField();
    const seen = vi.fn();
    window.addEventListener("keydown", seen);
    await openField(user);
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await user.keyboard("{Control>}{Enter}{/Control}");
    window.removeEventListener("keydown", seen);
    expect(onChange).not.toHaveBeenCalled();
    expect(seen.mock.calls.filter(([e]) => (e as KeyboardEvent).key === "Enter")).toHaveLength(2);
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("labels days starting with the visible number and marks days outside the month", async () => {
    const { user } = setupField();
    await openField(user);
    expect(day("2 October 2026, Friday")).toHaveAccessibleName(/^2 October/);
    expect(screen.getByRole("button", { name: "28 September 2026, Monday (other month)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "28 September 2026, Monday (other month)" })).toHaveTextContent("28");
    expect(day("2 October 2026, Friday")).not.toHaveAccessibleName(/other month/);
  });

  describe("copyFrom (Closed field)", () => {
    const copyFrom = { label: "Same as opened", value: "2027-03-15T09:20" };
    it("Same as opened copies the value and closes; hidden when there is nothing to copy", async () => {
      const { user, onChange, input, unmount } = setupField({ value: "", copyFrom });
      await openField(user);
      await user.click(screen.getByRole("button", { name: "Same as opened" }));
      expect(onChange).toHaveBeenLastCalledWith("2027-03-15T09:20");
      expect(input).toHaveValue("2027-03-15 09:20");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      unmount();
      const b = setupField({ value: "", copyFrom: { label: "Same as opened", value: "" } });
      await openField(b.user);
      expect(screen.queryByRole("button", { name: "Same as opened" })).not.toBeInTheDocument();
    });

    it("an empty field opens on the seed's month and a picked day takes its time", async () => {
      const { user, onChange } = setupField({ value: "", copyFrom });
      await openField(user);
      expect(screen.getByText("March 2027")).toBeInTheDocument();
      expect(screen.getByLabelText("Time (UTC)")).toHaveAttribute("placeholder", "09:20");
      await user.click(day("20 March 2027, Saturday"));
      expect(onChange).toHaveBeenLastCalledWith("2027-03-20T09:20");
    });

    it("a typed time on an empty field takes the seed's date; a value of its own wins over the seed", async () => {
      const { user, onChange, unmount } = setupField({ value: "", copyFrom });
      await openField(user);
      await user.type(screen.getByLabelText("Time (UTC)"), "10:00");
      expect(onChange).toHaveBeenLastCalledWith("2027-03-15T10:00");
      unmount();
      const b = setupField({ value: "2026-10-02T14:30", copyFrom });
      await openField(b.user);
      expect(screen.getByText("October 2026")).toBeInTheDocument();
      await b.user.click(day("20 October 2026, Tuesday"));
      expect(b.onChange).toHaveBeenLastCalledWith("2026-10-20T14:30");
    });
  });
});
