import { randomBytes } from "node:crypto";
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
    // Production build: dev-server compiles on first hit made time-sensitive journeys flaky (challenge window).
    command: `pnpm build && pnpm db:template && pnpm build:standalone && cd .next/standalone && node --max-old-space-size=320 --liftoff-only db-boot.cjs boot && node --max-old-space-size=320 --liftoff-only server.js`,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 300_000,
    reuseExistingServer: false,
    env: {
      APP_MODE: "MOCK",
      PROCUREBOT_API_KEY: process.env.PROCUREBOT_API_KEY ?? randomBytes(24).toString("hex"),
      LLM_PROVIDER: "stub",
      API_KEY_PEPPER: "e2e-only-pepper",
      SESSION_SECRET: "e2e-only-session-secret-at-least-32-chars",
      PORT: String(PORT),
      HOSTNAME: "127.0.0.1",
      PGLITE_DATA_DIR: ".data/e2e",
      CHALLENGE_WINDOW_SECONDS: "30", // long enough to open a dispute through the UI
    },
  },
});
