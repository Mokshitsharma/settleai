import { randomBytes } from "node:crypto";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    env: { PROCUREBOT_API_KEY: randomBytes(24).toString("hex") },
    // Keep every result on disk: a one-off failure must leave its error behind to diagnose.
    reporters: ["default", ["json", { outputFile: ".data/last-test-results.json" }]],
    // Same flag as production: without it each PGlite start spikes to about 600 MB in every worker.
    execArgv: ["--liftoff-only"],
    // One worker keeps the peak well under this machine's free memory; two still paused the commit gate.
    maxWorkers: 1,
    testTimeout: 60_000,
    hookTimeout: 90_000,
  },
});
