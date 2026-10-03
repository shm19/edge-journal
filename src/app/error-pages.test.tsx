// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Error from "./error";
import GlobalError from "./global-error";
import NotFound from "./not-found";

vi.mock("./globals.css", () => ({}));

describe("error.tsx", () => {
  it("shows a friendly message and the digest, never the stack or message, and Try again calls reset", async () => {
    const reset = vi.fn();
    const error = Object.assign(new globalThis.Error("SQLITE secret detail at /data/journal.db"), { digest: "123456" });
    error.stack = "STACKTRACE-MARKER";
    render(<Error error={error} reset={reset} />);
    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeInTheDocument();
    expect(screen.getByText(/Error ID: 123456/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("SQLITE");
    expect(document.body.textContent).not.toContain("STACKTRACE-MARKER");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/");
  });
  it("omits the digest line when there is none", () => {
    render(<Error error={new globalThis.Error("x")} reset={() => {}} />);
    expect(screen.queryByText(/Error ID/)).toBeNull();
  });
});

describe("global-error.tsx", () => {
  it("renders the same screen with a working Try again", async () => {
    const reset = vi.fn();
    // <html> inside a div is dropped by the DOM, so render into the document root instead of a container.
    render(<GlobalError error={new globalThis.Error("x")} reset={reset} />, { container: document.documentElement });
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledOnce();
  });
});

describe("not-found.tsx", () => {
  it("explains and links back to the dashboard", () => {
    render(<NotFound />);
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to dashboard" })).toHaveAttribute("href", "/");
  });
});
