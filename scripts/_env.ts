// Load .env.local for scripts the same way Next.js does for the app. Missing file is fine (MOCK mode).
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // not present
  }
}
