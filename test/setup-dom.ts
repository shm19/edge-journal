// Matchers + automatic cleanup for component tests (files that opt in with `// @vitest-environment jsdom`).
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());
