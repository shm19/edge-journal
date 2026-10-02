import { describe, expect, it } from "vitest";
import { csvCell } from "./csv";
import { sniff } from "./image-sniff";

describe("csvCell", () => {
  it("handles null, numbers and plain text", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(-1.5)).toBe("-1.5");
    expect(csvCell(false)).toBe("false");
    expect(csvCell("abc")).toBe("abc");
  });
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("a\nb")).toBe('"a\nb"');
  });
  it("neutralises formulas in text but not numeric strings", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("+1+1")).toBe("'+1+1");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("-x")).toBe("'-x");
    expect(csvCell("-12.5")).toBe("-12.5");
    expect(csvCell("=1,2")).toBe(`"'=1,2"`);
  });
});

describe("sniff", () => {
  const pad = (b: number[]) => Buffer.from([...b, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  it("recognises the four formats by magic bytes", () => {
    expect(sniff(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
    expect(sniff(pad([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
    expect(sniff(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))).toBe("webp");
    expect(sniff(Buffer.from("GIF89a\0\0"))).toBe("gif");
    expect(sniff(Buffer.from("GIF87a\0\0"))).toBe("gif");
  });
  it("rejects everything else, including truncated headers", () => {
    expect(sniff(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniff(Buffer.from("GIF88a"))).toBeNull();
    expect(sniff(Buffer.from("RIFF\0\0\0\0WAVE"))).toBeNull();
    expect(sniff(Buffer.from([0x89, 0x50]))).toBeNull();
    expect(sniff(Buffer.alloc(0))).toBeNull();
  });
});
