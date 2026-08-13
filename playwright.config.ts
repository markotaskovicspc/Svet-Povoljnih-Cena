import { defineConfig, devices } from "@playwright/test";
import {
  pinE2EDatabaseAliases,
  requireSafeE2EDatabase,
} from "./tests/helpers/e2e-database-safety";

const e2eDatabaseUrl = requireSafeE2EDatabase();
if (e2eDatabaseUrl) pinE2EDatabaseAliases(e2eDatabaseUrl);

const playwrightPort = process.env.PLAYWRIGHT_PORT ?? "3000";
const localBaseUrl = `http://127.0.0.1:${playwrightPort}`;
const requestedWebServerTimeout = Number(
  process.env.PLAYWRIGHT_WEBSERVER_TIMEOUT_MS,
);
const webServerTimeout = Number.isFinite(requestedWebServerTimeout)
  ? Math.max(30_000, Math.min(requestedWebServerTimeout, 600_000))
  : 120_000;
const requestedWorkers = Number(process.env.PLAYWRIGHT_WORKERS);
const workers =
  Number.isInteger(requestedWorkers) && requestedWorkers > 0
    ? requestedWorkers
    : 1;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  // All projects share one local Next dev server. Serial-by-default avoids
  // cold RSC requests exhausting the server's single constrained DB pool.
  workers,
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
        timeout: webServerTimeout,
      },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
