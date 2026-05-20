import { defineConfig, devices } from "@playwright/test";

const PORT = 5173;
const BASE_URL = `http://localhost:${PORT}`;

// Playwright config for the playground's chat e2e tests.
//
// We rely on the existing Vite dev server (which mounts the dev-agent-plugin
// — see server/dev-agent-plugin.ts) so the SSE stream, conversations API, and
// keyword scenarios are all available without a real backend. CI gets a fresh
// dev server per run; locally Playwright reuses an already-running one.
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // Boot Vite (with the dev-agent-plugin) before the suite starts. Reuse a
  // server that's already running locally so devs don't pay the boot cost
  // on every run.
  webServer: {
    command: "bun run dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
