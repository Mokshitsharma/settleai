// pnpm verify-receipt <receipt.json> [--platform-keys <url-or-file>]
// Offline verification of a SettleAI receipt. Exit code 0 when every check passes, 1 otherwise.
import { readFile } from "node:fs/promises";
import { verifyReceipt } from "@/core/verifier/receipt";

async function loadJson(source: string): Promise<unknown> {
  if (/^https?:\/\//.test(source)) return (await fetch(source)).json();
  return JSON.parse(await readFile(source, "utf8"));
}

async function main() {
  const [file, ...rest] = process.argv.slice(2);
  if (!file) {
    console.error("Usage: pnpm verify-receipt <receipt.json> [--platform-keys <url-or-file>]");
    process.exit(2);
  }
  const keysArg = rest[rest.indexOf("--platform-keys") + 1];
  const trusted = rest.includes("--platform-keys") && keysArg ? ((await loadJson(keysArg)) as { keyIds: string[] }).keyIds : undefined;

  let bundle: unknown;
  try {
    bundle = JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    console.error(`✗ Receipt file is not valid JSON (${(err as Error).message})`);
    process.exit(1);
  }
  const result = await verifyReceipt(bundle, { trustedPlatformKeyIds: trusted });
  for (const c of result.checks) {
    console.log(`${c.ok ? "✓" : "✗"} ${c.label}: ${c.detail}${c.pointer ? `\n    at ${c.pointer}` : ""}`);
  }
  for (const w of result.warnings) console.log(`! ${w}`);
  console.log(result.ok ? "\nReceipt verified." : "\nReceipt FAILED verification.");
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
