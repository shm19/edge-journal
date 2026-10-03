import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
const token = (name: string) => new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)![1];
const channel = (hex: string, i: number) => {
  const v = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2);
const contrastWithWhite = (hex: string) => 1.05 / (luminance(hex) + 0.05);

describe("button colours", () => {
  it.each(["accent-strong", "accent-hover"])("white text on %s meets WCAG AA (4.5:1)", (name) => {
    expect(contrastWithWhite(token(name))).toBeGreaterThanOrEqual(4.5);
  });
});
