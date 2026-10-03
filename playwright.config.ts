import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";
import { BASE_URL, PASSWORD, PORT, SESSION_SECRET } from "./e2e/env";

/** Fresh, throwaway data dir. Wiped by the server command before each run and by global-teardown after it. */
export const DATA_DIR = path.join(os.tmpdir(), `edge-journal-e2e-${PORT}`);

export default defineConfig({
  testDir: "./e2e",
  globalTeardown: "./e2e/global-teardown.ts",
  workers: 1, // every spec shares one DB and builds on the data of the earlier ones
  fullyParallel: false,
  retries: 0,
  timeout: 30_000,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    channel: "chrome", // the system Google Chrome: no browser download needed
    headless: true,
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: {} }],
  webServer: {
    // A separate dist dir keeps the dev server (.next/dev) and the standalone backtest instance (.next/standalone) untouched.
    command: `rm -rf "${DATA_DIR}" && mkdir -p "${DATA_DIR}" && npm run build && npx next start -p ${PORT}`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      NEXT_DIST_DIR: ".next-e2e",
      NODE_ENV: "production",
      DATA_DIR,
      APP_PASSWORD: PASSWORD,
      SESSION_SECRET,
      COOKIE_SECURE: "false", // plain http on localhost
    },
  },
});
