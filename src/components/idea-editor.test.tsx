// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyScenario, newEditorIdea, type EditorIdea } from "@/lib/editor-shape";
import { makeSetup } from "../../test/fixtures";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/ideas/new",
  useSearchParams: () => new URLSearchParams(),
}));
const saveIdea = vi.fn();
vi.mock("@/lib/actions", () => ({
  saveIdea: (...a: unknown[]) => saveIdea(...a),
  saveScenarioType: vi.fn(async () => ({ ok: true, data: { id: 50 } })),
  saveMistakeType: vi.fn(async () => ({ ok: true, data: { id: 60 } })),
}));

import { IdeaEditor } from "./idea-editor";

const SCENARIO_TYPES = [{ id: 1, name: "Hold to target", description: "" }];
const MISTAKE_TYPES = [{ id: 2, name: "Early TP", description: "" }];

function renderEditor(initial: EditorIdea = newEditorIdea({ symbol: "BTC" }), over: Partial<React.ComponentProps<typeof IdeaEditor>> = {}) {
  render(
    <IdeaEditor
      initial={initial}
      setups={[]}
      tags={[]}
      scenarioTypes={SCENARIO_TYPES}
      mistakeTypes={MISTAKE_TYPES}
      symbols={["BTC"]}
      minRR={2}
      beThreshold={0.1}
      {...over}
    />,
  );
  return userEvent.setup();
}

/** Fill the primary scenario of a long: entry 100, stop 90 (1R = 10), target 120. */
async function fillPrimary(user: ReturnType<typeof userEvent.setup>, exit = "") {
  const card = screen.getAllByLabelText("Entry")[0];
  await user.type(card, "100");
  await user.type(screen.getAllByLabelText(/^Stop/)[0], "90");
  await user.type(screen.getAllByLabelText(/^Target/)[0], "120");
  if (exit) await user.type(screen.getAllByLabelText("Exit")[0], exit);
}

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  saveIdea.mockReset();
  vi.restoreAllMocks();
});

describe("live R, R:R and price echo", () => {
  it("computes planned R:R and realised R as you type", async () => {
    const user = renderEditor();
    await fillPrimary(user);
    expect(screen.getByText("2.00 R:R")).toBeInTheDocument();
    expect(screen.getByText("open")).toBeInTheDocument();
    await user.type(screen.getAllByLabelText("Exit")[0], "110");
    expect(screen.getByText("+1.00R")).toBeInTheDocument();
    expect(screen.getByText(/stop 10\.00%/)).toBeInTheDocument();
  });

  it("echoes the interpreted number when separators are typed", async () => {
    const user = renderEditor();
    await user.type(screen.getAllByLabelText("Entry")[0], "64,250");
    expect(screen.getByText("= 64,250")).toBeInTheDocument();
  });

  it("flags an unparseable price", async () => {
    const user = renderEditor();
    await user.type(screen.getAllByLabelText("Entry")[0], "1.2.3");
    expect(screen.getByText("Not a number")).toBeInTheDocument();
  });

  it("explains a stop on the wrong side", async () => {
    const user = renderEditor();
    await user.type(screen.getAllByLabelText("Entry")[0], "100");
    await user.type(screen.getAllByLabelText(/^Stop/)[0], "110");
    expect(screen.getByText("Stop must be below entry for a long.")).toBeInTheDocument();
  });
});

describe("quick exits", () => {
  it("Hit target / Stopped / Breakeven / Still open fill the exit and the R", async () => {
    const user = renderEditor();
    await fillPrimary(user);
    await user.click(screen.getByRole("button", { name: "Hit target" }));
    expect(screen.getAllByLabelText("Exit")[0]).toHaveValue("120");
    expect(screen.getByText("+2.00R")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Stopped" }));
    expect(screen.getByText("-1.00R")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Breakeven" }));
    expect(screen.getByText("0.00R")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Still open" }));
    expect(screen.getAllByLabelText("Exit")[0]).toHaveValue("");
    expect(screen.getByText("open")).toBeInTheDocument();
  });

  it("Hit target needs a target", async () => {
    const user = renderEditor();
    await user.type(screen.getAllByLabelText("Entry")[0], "100");
    expect(screen.getByRole("button", { name: "Hit target" })).toBeDisabled();
  });
});

describe("not filled", () => {
  it("is offered for a plan that was not taken: 0R, exit disabled", async () => {
    const user = renderEditor(newEditorIdea({ symbol: "BTC", status: "skipped" }));
    await fillPrimary(user);
    await user.click(screen.getByRole("button", { name: "Not filled" }));
    expect(screen.getByText("not filled · 0R")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Exit")[0]).toBeDisabled();
  });

  it("is not offered for the primary of a taken trade", () => {
    renderEditor();
    expect(screen.queryByRole("button", { name: "Not filled" })).not.toBeInTheDocument();
  });
});

describe("closing time", () => {
  const closedInput = () => screen.getByLabelText(/Closed \(UTC\)/) as HTMLInputElement;
  const openedInput = () => screen.getByLabelText(/Opened \(UTC\)/) as HTMLInputElement;

  it("defaults to the open time (labelled) rather than now, and Still open takes it back", async () => {
    const initial = { ...newEditorIdea({ symbol: "BTC" }), openedAt: "2026-09-10T10:00:00.000Z" };
    const user = renderEditor(initial);
    expect(closedInput().value).toBe("");
    await fillPrimary(user);
    await user.type(screen.getAllByLabelText("Exit")[0], "110");
    expect(closedInput().value).toBe("2026-09-10T10:00");
    expect(screen.getByText(/Set to the open time/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Still open" }));
    expect(closedInput().value).toBe("");
    expect(openedInput().value).toBe("2026-09-10T10:00");
  });

  it("keeps a time the user typed when the trade is reopened", async () => {
    const initial = { ...newEditorIdea({ symbol: "BTC" }), openedAt: "2026-09-10T10:00:00.000Z" };
    const user = renderEditor(initial);
    await fillPrimary(user, "110");
    fireEvent.change(closedInput(), { target: { value: "2026-09-11T08:30" } });
    expect(screen.queryByText(/Set to the open time/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Still open" }));
    expect(closedInput().value).toBe("2026-09-11T08:30");
  });
});

describe("observation mode", () => {
  const forward = () => ({ ...newEditorIdea({ symbol: "BTC", status: "forward_test" }) });

  it("hides prices, requires Hit/Miss, and saves without scenarios", async () => {
    saveIdea.mockResolvedValue({ ok: true, data: { id: 7 } });
    const user = renderEditor(forward());
    await user.click(screen.getByRole("radio", { name: "Hit / Miss" }));
    expect(screen.getByText("Observation")).toBeInTheDocument();
    expect(screen.queryAllByLabelText("Entry")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: /Save/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("Mark the observation as Hit or Miss");
    expect(saveIdea).not.toHaveBeenCalled();

    await user.click(screen.getByRole("radio", { name: "Hit" }));
    await user.click(screen.getByRole("button", { name: /Save/ }));
    expect(saveIdea).toHaveBeenCalledTimes(1);
    expect(saveIdea.mock.calls[0][0]).toMatchObject({ status: "forward_test", outcome: "hit", scenarios: [] });
    expect(push).toHaveBeenCalledWith("/ideas/7");
  });

  it("is not a dead end: switching an observation to Taken brings back a primary scenario", async () => {
    const saved = { ...forward(), id: 5, scenarios: [], outcome: "hit" as const };
    const user = renderEditor(saved);
    expect(screen.getByText("Observation")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Taken" }));
    expect(screen.getByText("Scenarios")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Entry")).toHaveLength(1);
    expect(screen.getByText("Actual")).toBeInTheDocument();
  });

  it("asks before dropping scenarios that have prices", async () => {
    const user = renderEditor(forward());
    await fillPrimary(user);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await user.click(screen.getByRole("radio", { name: "Hit / Miss" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("removes the primary scenario"));
    expect(screen.getAllByLabelText("Entry")[0]).toHaveValue("100"); // kept

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole("radio", { name: "Hit / Miss" }));
    expect(screen.queryAllByLabelText("Entry")).toHaveLength(0);
    // ...and back: a fresh empty primary
    await user.click(screen.getByRole("radio", { name: "Prices" }));
    expect(screen.getAllByLabelText("Entry")[0]).toHaveValue("");
  });

  it("does not ask when there is nothing to lose", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const user = renderEditor(forward());
    await user.click(screen.getByRole("radio", { name: "Hit / Miss" }));
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe("mistake cost", () => {
  async function withAlternative() {
    const user = renderEditor();
    await fillPrimary(user, "90"); // stopped out: -1R
    await user.click(screen.getByRole("button", { name: "Add Hold to target" }));
    // The alternative copies entry/stop/target; give it a +2R exit.
    await user.type(screen.getAllByLabelText("Exit")[1], "120");
    await user.click(screen.getByRole("button", { name: "Add Early TP" }));
    return user;
  }

  it("measures the linked alternative against the primary", async () => {
    const user = await withAlternative();
    expect(screen.queryByText(/(lost|saved)$/)).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Measure against alternative"), "Hold to target");
    expect(screen.getByText(/3\.00R lost$/)).toBeInTheDocument(); // +2R - (-1R)
  });

  it("a typed cost wins, and a saving shows as 'saved'", async () => {
    const user = await withAlternative();
    await user.selectOptions(screen.getByLabelText("Measure against alternative"), "Hold to target");
    await user.type(screen.getByLabelText("Cost in R"), "-0.5");
    expect(screen.getByText(/0\.50R saved$/)).toBeInTheDocument();
  });

  it("says 'Not a number' for a junk cost and blocks the save instead of dropping it", async () => {
    const user = await withAlternative();
    await user.type(screen.getByLabelText("Cost in R"), "-");
    expect(screen.getByText("Not a number")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Save/ }));
    expect(saveIdea).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/cost must be a number/i);
  });

  it("unlinks the mistake when its alternative is removed", async () => {
    const user = await withAlternative();
    await user.selectOptions(screen.getByLabelText("Measure against alternative"), "Hold to target");
    await user.click(screen.getByRole("button", { name: "Remove alternative" }));
    expect(screen.queryByText(/(lost|saved)$/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Measure against alternative")).toHaveValue("");
  });
});

describe("saving", () => {
  it("only submits once even if triggered twice before the first save returns", async () => {
    let resolve!: (v: unknown) => void;
    saveIdea.mockReturnValue(new Promise((r) => (resolve = r)));
    const user = renderEditor();
    await fillPrimary(user, "110");
    act(() => {
      fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
      fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    });
    expect(saveIdea).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Save/ })).toBeDisabled();
    await act(async () => resolve({ ok: true, data: { id: 3 } }));
    expect(push).toHaveBeenCalledWith("/ideas/3");
  });

  it("allows a retry after the server rejects the save, and shows its message", async () => {
    saveIdea.mockResolvedValueOnce({ ok: false, error: "Close time is before open time" }).mockResolvedValueOnce({ ok: true, data: { id: 3 } });
    const user = renderEditor();
    await fillPrimary(user, "110");
    await user.click(screen.getByRole("button", { name: /Save/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Close time is before open time");
    await user.click(screen.getByRole("button", { name: /Save/ }));
    expect(saveIdea).toHaveBeenCalledTimes(2);
    expect(push).toHaveBeenCalledWith("/ideas/3");
  });

  it("sends the scenarios parsed, with the close time defaulted to the open time", async () => {
    saveIdea.mockResolvedValue({ ok: true, data: { id: 3 } });
    const user = renderEditor({ ...newEditorIdea({ symbol: "BTC" }), openedAt: "2026-09-10T10:00:00.000Z" });
    await fillPrimary(user, "110");
    await user.click(screen.getByRole("button", { name: /Save/ }));
    expect(saveIdea.mock.calls[0][0]).toMatchObject({
      closedAt: "2026-09-10T10:00:00.000Z",
      scenarios: [{ isPrimary: true, entry: 100, stop: 90, target: 120, exitPrice: 110, exitReason: "manual" }],
    });
  });
});

describe("cancel and setup change", () => {
  it("Cancel goes to the journal for a new idea and to the idea page for a saved one", async () => {
    const user = renderEditor();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(push).toHaveBeenLastCalledWith("/ideas");
  });

  it("Cancel on a saved idea returns to its page", async () => {
    const saved = { ...newEditorIdea({ symbol: "BTC" }), id: 12 };
    const user = renderEditor(saved);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(push).toHaveBeenLastCalledWith("/ideas/12");
  });

  it("asks before discarding edits on Cancel", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = renderEditor();
    await user.type(screen.getAllByLabelText("Entry")[0], "1");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(confirm).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("warns before changing the setup wipes ticked checklist items", async () => {
    const lhpb = makeSetup({ id: 1, name: "LHPB", checklist: ["At level", "Clean candle"] });
    const other = makeSetup({ id: 2, name: "Other" });
    const initial = { ...newEditorIdea({ symbol: "BTC", setupId: 1 }), checklistState: { "At level": true } };
    const user = renderEditor(initial, { setups: [lhpb, other] });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await user.selectOptions(screen.getByLabelText("Setup"), "2");
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("1 ticked checklist item"));
    expect(screen.getByLabelText("Setup")).toHaveValue("1"); // unchanged
    expect(within(screen.getByText("Setup checklist").closest("div")!.parentElement!).getByText("1/2")).toBeInTheDocument();

    confirm.mockReturnValue(true);
    await user.selectOptions(screen.getByLabelText("Setup"), "2");
    expect(screen.getByLabelText("Setup")).toHaveValue("2");
  });

  it("does not ask when nothing is ticked", async () => {
    const lhpb = makeSetup({ id: 1, name: "LHPB", checklist: ["At level"] });
    const confirm = vi.spyOn(window, "confirm");
    const user = renderEditor(newEditorIdea({ symbol: "BTC", setupId: 1 }), { setups: [lhpb, makeSetup({ id: 2, name: "Other" })] });
    await user.selectOptions(screen.getByLabelText("Setup"), "2");
    expect(confirm).not.toHaveBeenCalled();
  });
});

it("emptyScenario keys are unique", () => {
  expect(emptyScenario(true).key).not.toBe(emptyScenario(true).key);
});
