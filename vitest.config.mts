import path from "node:path";
import { defineConfig } from "vitest/config";

const pure = { lines: 100, branches: 100 };
const server = { lines: 90, branches: 90 };

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "test/empty.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["test/setup.ts", "test/setup-dom.ts"],
    // Component tests are slow under v8 coverage instrumentation.
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/lib/**", "src/db/seed.ts", "src/app/api/**", "src/proxy.ts"],
      exclude: ["src/**/*.test.*"],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
        // Pure logic: everything covered.
        "src/lib/{stats,price,tz,format,validation,editor-shape,metrics,analytics,status,date-input}.ts": pure,
        // Server logic.
        "src/lib/{queries,actions,settings,auth,session,login-guard,csv,image-sniff}.ts": server,
        "src/db/seed.ts": server,
        "src/app/api/**": server,
        "src/proxy.ts": server,
      },
    },
  },
});
