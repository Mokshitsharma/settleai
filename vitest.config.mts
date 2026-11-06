import { randomBytes } from "node:crypto";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    env: { PROCUREBOT_API_KEY: randomBytes(24).toString("hex") },
    testTimeout: 60_000,
    hookTimeout: 90_000,
  },
});
