import { defineConfig, devices } from "@playwright/test";

// E2E runs against a fresh PGlite database in MOCK mode with the offline AI stub, so it is
// deterministic and needs no keys. The DB is reset and seeded before the dev server starts.
const PORT = 3200;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  // The dev server compiles each route on first hit, which can take several seconds.
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `pnpm db:reset && pnpm exec next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      APP_MODE: "MOCK",
      LLM_PROVIDER: "stub",
      PGLITE_DATA_DIR: ".data/e2e",
      CHALLENGE_WINDOW_SECONDS: "30", // long enough to open a dispute through the UI
    },
  },
});
