// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyScenario, newEditorIdea, type EditorIdea } from "@/lib/editor-shape";
import { makeSetup } from "../../test/fixtures";
import { chooseOption } from "../../test/select";

const push = vi.fn();
const replace = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh, replace, back: vi.fn() }),
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
  replace.mockReset();
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
  const closedInput = () => screen.getByLabelText("Closed (UTC)") as HTMLInputElement;
  const openedInput = () => screen.getByLabelText("Opened (UTC)") as HTMLInputElement;

  it("defaults to the open time (labelled) rather than now, and Still open takes it back", async () => {
    const initial = { ...newEditorIdea({ symbol: "BTC" }), openedAt: "2026-09-10T10:00:00.000Z" };
    const user = renderEditor(initial);
    expect(closedInput().value).toBe("");
    await fillPrimary(user);
    await user.type(screen.getAllByLabelText("Exit")[0], "110");
    expect(closedInput().value).toBe("2026-09-10 10:00");
    expect(screen.getByText(/Set to the open time/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Still open" }));
    expect(closedInput().value).toBe("");
    expect(openedInput().value).toBe("2026-09-10 10:00");
  });

  it("keeps a time the user typed when the trade is reopened", async () => {
    const initial = { ...newEditorIdea({ symbol: "BTC" }), openedAt: "2026-09-10T10:00:00.000Z" };
    const user = renderEditor(initial);
    await fillPrimary(user, "110");
    fireEvent.change(closedInput(), { target: { value: "2026-09-11 08:30" } });
    expect(screen.queryByText(/Set to the open time/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Still open" }));
    expect(closedInput().value).toBe("2026-09-11 08:30");
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
    expect(replace).toHaveBeenCalledWith("/ideas/7"); // replace: Back must not return to the form
    expect(push).not.toHaveBeenCalled();
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
    await chooseOption(user, "Measure against alternative", "Hold to target");
    expect(screen.getByText(/3\.00R lost$/)).toBeInTheDocument(); // +2R - (-1R)
  });

  it("a typed cost wins, and a saving shows as 'saved'", async () => {
    const user = await withAlternative();
    await chooseOption(user, "Measure against alternative", "Hold to target");
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
    await chooseOption(user, "Measure against alternative", "Hold to target");
    await user.click(screen.getByRole("button", { name: "Remove alternative" }));
    expect(screen.queryByText(/(lost|saved)$/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Measure against alternative")).toHaveTextContent("No alternatives yet");
  });
});

describe("invalid typed dates block saving", () => {
  it("Save and Cmd+Enter refuse while Closed holds invalid text, naming the field, then save once it is fixed", async () => {
    saveIdea.mockResolvedValue({ ok: true, data: { id: 9 } });
    const user = renderEditor();
    await fillPrimary(user, "110");
    const closed = screen.getByLabelText("Closed (UTC)");
    await user.clear(closed);
    await user.type(closed, "2026-02-30 10:00");
    await user.click(screen.getByRole("button", { name: /Save/ }));
    expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" ")).toMatch(/Fix the Closed date first/);
    act(() => {
      fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    });
    expect(saveIdea).not.toHaveBeenCalled();
    await user.clear(closed);
    await user.type(closed, "2026-10-02 10:00");
    await user.click(screen.getByRole("button", { name: /Save/ }));
    expect(saveIdea).toHaveBeenCalledTimes(1);
  });

  it("a required Opened box that was emptied blocks too, and both names are listed", async () => {
    const user = renderEditor();
    await fillPrimary(user, "110");
    await user.clear(screen.getByLabelText("Opened (UTC)"));
    const closed = screen.getByLabelText("Closed (UTC)");
    await user.clear(closed);
    await user.type(closed, "nope");
    await user.click(screen.getByRole("button", { name: /Save/ }));
    expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" ")).toMatch(/Fix the Opened and Closed date first/);
    expect(saveIdea).not.toHaveBeenCalled();
  });
});

describe("a typo in a price never saves silently", () => {
  it.each([
    ["Exit", "abc", "Primary · Exit: must be a number"],
    ["Target (FTA)", "1.2.3", "Primary · Target: must be a number"],
    ["Entry", "x1", "Primary · Entry: must be a number"],
  ])("%s %s blocks the save, names the field and focuses it", async (label, text, message) => {
    const user = renderEditor();
    await fillPrimary(user);
    const box = screen.getAllByLabelText(label)[0];
    await user.clear(box);
    await user.type(box, text);
    expect(box).toHaveValue(text); // the typo stays visible instead of being filtered out
    await user.click(screen.getByRole("button", { name: /Save/ }));
    expect(saveIdea).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" ")).toContain(message);
    expect(box).toHaveFocus();
    expect(box).toHaveAttribute("aria-invalid", "true");
  });

  it("price boxes have names that say which scenario they belong to", async () => {
    const user = renderEditor();
    await user.click(screen.getByRole("button", { name: "Add Hold to target" }));
    for (const f of ["entry", "stop", "target", "exit"]) {
      expect(screen.getByRole("textbox", { name: `Primary ${f} price` })).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: `Alternative 1 ${f} price` })).toBeInTheDocument();
    }
  });
});

describe("Coin and failed-save focus", () => {
  it("a blank Coin says 'Pick a coin' under the field, focuses it, and the message clears once the form changes", async () => {
    const user = renderEditor(newEditorIdea({}));
    await fillPrimary(user);
    await user.click(screen.getByRole("button", { name: /Save/ }));
    expect(saveIdea).not.toHaveBeenCalled();
    const coin = screen.getByLabelText("Coin");
    expect(coin).toHaveFocus();
    expect(coin).toHaveAttribute("aria-invalid", "true");
    expect(screen.getAllByText("Pick a coin")).toHaveLength(2); // inline + save bar
    await user.type(coin, "ETH");
    expect(screen.getAllByText("Pick a coin")).toHaveLength(1); // only the stale save-bar summary is left
  });

  it("the placeholder does not look like a value", () => {
    renderEditor(newEditorIdea({}));
    expect(screen.getByLabelText("Coin")).toHaveAttribute("placeholder", "e.g. BTC");
  });

  it("a server error about a field focuses that field too", async () => {
    saveIdea.mockResolvedValueOnce({ ok: false, error: "Primary · Stop: must be below entry for a long" });
    const user = renderEditor();
    await fillPrimary(user);
    await user.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(screen.getAllByLabelText(/^Stop/)[0]).toHaveFocus());
    expect(screen.getByText("must be below entry for a long")).toBeInTheDocument();
  });

  it("an invalid date focuses its box", async () => {
    const user = renderEditor();
    await fillPrimary(user, "110");
    const closed = screen.getByLabelText("Closed (UTC)");
    await user.clear(closed);
    await user.type(closed, "garbage");
    await user.click(screen.getByRole("button", { name: /Save/ }));
    expect(closed).toHaveFocus();
  });
});

describe("Closed text that is not a date (no blur first)", () => {
  it("garbage typed into an empty Closed blocks Cmd+Enter and Save even though the box was never blurred", async () => {
    saveIdea.mockResolvedValue({ ok: true, data: { id: 9 } });
    const user = renderEditor();
    await fillPrimary(user); // still open: Closed is empty
    const closed = screen.getByLabelText("Closed (UTC)");
    await user.type(closed, "garbage"); // focus stays in the box
    act(() => {
      fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    });
    expect(saveIdea).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" ")).toMatch(/Fix the Closed date first/);
    await user.click(screen.getByRole("button", { name: /Save/ }));
    expect(saveIdea).not.toHaveBeenCalled();
  });
});

describe("Hit / Miss next to prices (forward test)", () => {
  const forward = () => newEditorIdea({ symbol: "BTC", status: "forward_test" });

  it("hides the result row until entry and stop are filled, and explains the Hit / Miss tab", async () => {
    const user = renderEditor(forward());
    expect(screen.queryByText("Did it play out?")).not.toBeInTheDocument();
    expect(screen.getByText(/switch to/)).toHaveTextContent("Hit / Miss");
    await user.type(screen.getAllByLabelText("Entry")[0], "100");
    await user.type(screen.getAllByLabelText(/^Stop/)[0], "90");
    expect(screen.getByText("Did it play out?")).toBeInTheDocument();
  });

  it("saving with no prices points at the Hit / Miss tab", async () => {
    const user = renderEditor(forward());
    await user.click(screen.getByRole("button", { name: /Save/ }));
    expect(saveIdea).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Add entry and stop, or switch to Hit / Miss (no prices)");
  });
});

describe("screenshot upload errors", () => {
  const drop = (name: string, type: string) => {
    const input = screen.getByLabelText("Add screenshots") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], name, { type })] } });
  };
  const respond = (status: number, body: unknown) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
  afterEach(() => vi.unstubAllGlobals());

  it("shows the server's 415 text next to the dropzone (role=alert), and a later good upload clears it", async () => {
    respond(415, { error: "Only PNG, JPG, WEBP or GIF images" });
    renderEditor();
    drop("fake.png", "image/png");
    expect(await screen.findByText("Only PNG, JPG, WEBP or GIF images")).toBeInTheDocument();
    const alert = screen.getAllByRole("alert").find((a) => a.textContent?.includes("Only PNG"))!;
    expect(screen.getByText("Screenshots").closest(".rounded-xl")).toContainElement(alert);
    respond(200, { fileName: "ok.png" });
    drop("ok.png", "image/png");
    await waitFor(() => expect(screen.queryByText("Only PNG, JPG, WEBP or GIF images")).not.toBeInTheDocument());
  });

  it("shows the 413 text, and falls back to the status when the body is not JSON", async () => {
    respond(413, { error: "Image is larger than 10 MB" });
    renderEditor();
    drop("big.png", "image/png");
    expect(await screen.findByText("Image is larger than 10 MB")).toBeInTheDocument();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 502 })));
    drop("a.png", "image/png");
    expect(await screen.findByText("Upload failed (502)")).toBeInTheDocument();
  });

  it("a file that is not an image is refused before upload, with a message in the card", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderEditor();
    drop("notes.txt", "text/plain");
    expect(screen.getByText("Only images can be attached (PNG, JPG, WEBP, GIF)")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("unsaved edits and in-app links", () => {
  const withLink = () => {
    const a = document.createElement("a");
    a.href = "/ideas";
    a.textContent = "Journal link";
    document.body.appendChild(a);
    return a;
  };
  afterEach(() => document.querySelectorAll("a[data-test-link]").forEach((n) => n.remove()));

  it("asks before an in-app link discards a dirty editor, and blocks the click when declined", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = renderEditor();
    await user.type(screen.getAllByLabelText("Entry")[0], "1");
    const link = withLink();
    link.dataset.testLink = "1";
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(click);
    expect(confirm).toHaveBeenCalledWith("Discard your unsaved changes?");
    expect(click.defaultPrevented).toBe(true);
  });

  it("lets the click through when the user confirms", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = renderEditor();
    await user.type(screen.getAllByLabelText("Entry")[0], "1");
    const link = withLink();
    link.dataset.testLink = "1";
    link.addEventListener("click", (e) => e.preventDefault()); // jsdom can't navigate
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(click);
    expect(window.confirm).toHaveBeenCalled();
  });

  it("never asks when nothing changed, for modified clicks, external links or the current page", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const link = withLink();
    link.dataset.testLink = "1";
    link.addEventListener("click", (e) => e.preventDefault());
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    expect(confirm).not.toHaveBeenCalled(); // clean editor
    const user = renderEditor();
    await user.type(screen.getAllByLabelText("Entry")[0], "1");
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, metaKey: true }));
    link.href = "https://example.com/x";
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    link.href = window.location.href;
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    expect(confirm).not.toHaveBeenCalled();
  });

  it("does not block after a successful save (the redirect is not a discard)", async () => {
    saveIdea.mockResolvedValue({ ok: true, data: { id: 3 } });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = renderEditor();
    await fillPrimary(user, "110");
    await user.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(replace).toHaveBeenCalled());
    const link = withLink();
    link.dataset.testLink = "1";
    link.addEventListener("click", (e) => e.preventDefault());
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    expect(confirm).not.toHaveBeenCalled();
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
    expect(replace).toHaveBeenCalledWith("/ideas/3"); // replace: Back must not return to the form
    expect(push).not.toHaveBeenCalled();
  });

  it("allows a retry after the server rejects the save, and shows its message", async () => {
    saveIdea.mockResolvedValueOnce({ ok: false, error: "Close time is before open time" }).mockResolvedValueOnce({ ok: true, data: { id: 3 } });
    const user = renderEditor();
    await fillPrimary(user, "110");
    await user.click(screen.getByRole("button", { name: /Save/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Close time is before open time");
    await waitFor(() => expect(screen.getByRole("button", { name: /Save/ })).toBeEnabled()); // the transition may still be pending
    await user.click(screen.getByRole("button", { name: /Save/ }));
    expect(saveIdea).toHaveBeenCalledTimes(2);
    expect(replace).toHaveBeenCalledWith("/ideas/3"); // replace: Back must not return to the form
    expect(push).not.toHaveBeenCalled();
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
    await chooseOption(user, "Setup", "Other");
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("1 ticked checklist item"));
    expect(screen.getByLabelText("Setup")).toHaveTextContent("LHPB"); // unchanged
    expect(within(screen.getByText("Setup checklist").closest("div")!.parentElement!).getByText("1/2")).toBeInTheDocument();

    confirm.mockReturnValue(true);
    await chooseOption(user, "Setup", "Other");
    expect(screen.getByLabelText("Setup")).toHaveTextContent("Other");
  });

  it("does not ask when nothing is ticked", async () => {
    const lhpb = makeSetup({ id: 1, name: "LHPB", checklist: ["At level"] });
    const confirm = vi.spyOn(window, "confirm");
    const user = renderEditor(newEditorIdea({ symbol: "BTC", setupId: 1 }), { setups: [lhpb, makeSetup({ id: 2, name: "Other" })] });
    await chooseOption(user, "Setup", "Other");
    expect(confirm).not.toHaveBeenCalled();
  });
});

it("emptyScenario keys are unique", () => {
  expect(emptyScenario(true).key).not.toBe(emptyScenario(true).key);
});
