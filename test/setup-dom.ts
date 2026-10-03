// Matchers + automatic cleanup for component tests (files that opt in with `// @vitest-environment jsdom`).
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());

// jsdom lacks these; Radix Popover and cmdk use them.
if (typeof window !== "undefined") {
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= function () {};
}
