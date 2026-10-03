import type { NextConfig } from "next";

// Uploaded screenshots get their own, stricter CSP (default-src 'none'; sandbox). Next merges header rules per key,
// so the global CSP must NOT match them or the two would fight; every other header still applies to uploads.
const UPLOADS = "/api/uploads";
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];
// img-src: no remote images (a markdown `![](https://tracker/x.png)` would leak the viewer's IP); blob: = pasted-screenshot previews,
// data: = the select chevron.
const APP_CSP = "frame-ancestors 'none'; img-src 'self' data: blob:";

const nextConfig: NextConfig = {
  output: "standalone",
  distDir: process.env.NEXT_DIST_DIR || ".next", // e2e builds into .next-e2e so it never clobbers dev / the backtest instance
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      { source: `/((?!${UPLOADS.slice(1)}/).*)`, headers: [{ key: "Content-Security-Policy", value: APP_CSP }] },
      { source: `${UPLOADS}/:path*`, headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; sandbox" }] },
      // The journal must never sit in a browser or proxy cache.
      { source: "/api/export/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
  serverExternalPackages: ["better-sqlite3"],
  // Migrations are read at runtime from ./drizzle; make sure they ship with the standalone build.
  outputFileTracingIncludes: { "/**": ["./drizzle/**/*"] },
  // The tracer follows `process.cwd()` joins and drags the whole repo into .next/standalone. The runtime needs none of this.
  outputFileTracingExcludes: {
    "/**": [
      "./src/**/*",
      "./docs/**/*",
      "./test/**/*",
      "./e2e/**/*",
      "./coverage/**/*",
      "./test-results/**/*",
      "./scripts/**/*",
      "./*.md",
      "./*.config.*",
      "./docker-compose.yml",
      "./Dockerfile",
      "./package-lock.json",
      "./tsconfig*.json",
      "./.data*/**/*",
    ],
  },
};

export default nextConfig;
