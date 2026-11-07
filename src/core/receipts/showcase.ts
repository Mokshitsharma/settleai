// The showcase receipt: the signed record of one real job on the PayPal sandbox and a real model, frozen by
// `pnpm showcase:make`. It is served from this file, not the database, so its URL and bytes survive every restart
// and redeploy while the demo database resets. It is never regenerated at runtime.
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ReceiptBundle } from "@/core/verifier/receipt";

export const SHOWCASE_ID = "showcase";

export function showcaseFile(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.env.SHOWCASE_RECEIPT_FILE ?? "assets/showcase/receipt.json");
}

/** The frozen bytes, exactly as signed and verified when they were made. */
export async function showcaseRaw(): Promise<string | null> {
  return readFile(showcaseFile(), "utf8").catch(() => null);
}

export async function showcaseBundle(): Promise<ReceiptBundle | null> {
  const raw = await showcaseRaw();
  return raw ? (JSON.parse(raw) as ReceiptBundle) : null;
}
