import { expect, it } from "vitest";
import { METRICS } from "./metrics";

it("lists every metric with a unique key and a label", () => {
  expect(new Set(METRICS.map((m) => m.key)).size).toBe(METRICS.length);
  expect(METRICS.every((m) => m.label.length > 0)).toBe(true);
});
