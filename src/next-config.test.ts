// @ts-expect-error Next ships no types for its compiled copy of path-to-regexp (the matcher Next itself uses for header sources)
import { pathToRegexp } from "next/dist/compiled/path-to-regexp";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

type Rule = { source: string; headers: { key: string; value: string }[] };

/** Header values Next would send for `pathname`: every matching rule, merged per key (later rules win). */
async function headersFor(pathname: string) {
  const rules = (await nextConfig.headers!()) as Rule[];
  const merged = new Map<string, string>();
  const matches: Rule[] = [];
  for (const r of rules) {
    if (pathToRegexp(r.source).test(pathname)) {
      matches.push(r);
      for (const h of r.headers) merged.set(h.key, h.value);
    }
  }
  return { merged, matches };
}
const cspRules = (m: Rule[]) => m.filter((r) => r.headers.some((h) => h.key === "Content-Security-Policy"));

describe("next.config headers", () => {
  it.each(["/", "/ideas/5", "/settings", "/login", "/api/health", "/api/export"])(
    "%s gets the security headers and exactly one app CSP that blocks remote images and framing",
    async (p) => {
      const { merged, matches } = await headersFor(p);
      expect(merged.get("X-Frame-Options")).toBe("DENY");
      expect(merged.get("X-Content-Type-Options")).toBe("nosniff");
      expect(merged.get("Referrer-Policy")).toBe("same-origin");
      expect(merged.get("Permissions-Policy")).toBe("camera=(), microphone=(), geolocation=()");
      expect(cspRules(matches)).toHaveLength(1);
      expect(merged.get("Content-Security-Policy")).toBe("frame-ancestors 'none'; img-src 'self' data: blob:");
    },
  );

  it("an uploaded screenshot gets exactly one CSP, the strict sandboxed one, plus the common headers", async () => {
    const { merged, matches } = await headersFor("/api/uploads/abc-123.png");
    expect(cspRules(matches)).toHaveLength(1);
    expect(merged.get("Content-Security-Policy")).toBe("default-src 'none'; sandbox");
    expect(merged.get("X-Content-Type-Options")).toBe("nosniff");
    expect(merged.get("X-Frame-Options")).toBe("DENY");
  });

  it("exports are never cached; other routes are untouched", async () => {
    expect((await headersFor("/api/export")).merged.get("Cache-Control")).toBe("no-store");
    expect((await headersFor("/")).merged.has("Cache-Control")).toBe(false);
    expect((await headersFor("/api/uploads/a.png")).merged.has("Cache-Control")).toBe(false);
  });

  it("the standalone trace keeps ./drizzle and drops the source tree", () => {
    expect(nextConfig.outputFileTracingIncludes!["/**"]).toContain("./drizzle/**/*");
    expect(nextConfig.outputFileTracingExcludes!["/**"]).toEqual(expect.arrayContaining(["./src/**/*", "./docs/**/*", "./e2e/**/*"]));
    expect(nextConfig.outputFileTracingExcludes!["/**"].some((g) => g.includes("drizzle"))).toBe(false);
  });
});
