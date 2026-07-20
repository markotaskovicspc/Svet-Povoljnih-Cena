import { defineConfig, devices } from "@playwright/test";

const playwrightPort = process.env.PLAYWRIGHT_PORT ?? "3000";
const localBaseUrl = `http://127.0.0.1:${playwrightPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? localBaseUrl,
    trace: "retain-on-failure",
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `npm run dev -- --hostname 127.0.0.1 --port ${playwrightPort}`,
        url: localBaseUrl,
        reuseExistingServer:
          process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER === "1",
        timeout: 120_000,
      },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
