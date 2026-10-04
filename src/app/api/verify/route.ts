import { getContainer } from "@/core/container";
import { verifyReceipt } from "@/core/verifier/receipt";
import { HttpError, handle } from "../_lib";

/** Server-side verification of an uploaded receipt (same code as the CLI and the /verify page). */
export const POST = handle(async (req: Request) => {
  const text = await req.text();
  if (text.length > 2_000_000) throw new HttpError(413, "TOO_LARGE", "Receipt is too large");
  let bundle: unknown;
  try {
    bundle = JSON.parse(text);
  } catch {
    return Response.json({ ok: false, checks: [{ id: "json", label: "Receipt file", ok: false, detail: "The file is not valid JSON, so it cannot be a SettleAI receipt" }], warnings: [] });
  }
  const c = await getContainer();
  return Response.json(await verifyReceipt(bundle, { trustedPlatformKeyIds: await c.receipts.platformKeyIds() }));
});
