import { getContainer } from "@/core/container";

export const dynamic = "force-dynamic";

/** PayPal webhook receiver. Signature verified by the payments adapter; replays return 200 with no effect. */
export async function POST(req: Request) {
  const c = await getContainer();
  const body = await req.text();
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
  try {
    const outcome = await c.webhooks.process(headers, body);
    if (outcome === "rejected") return Response.json({ error: { code: "INVALID_SIGNATURE", message: "Webhook rejected" } }, { status: 400 });
    return Response.json({ ok: true, outcome });
  } catch (err) {
    console.error("webhook processing failed", err);
    // 500 makes PayPal retry later; the handler is idempotent.
    return Response.json({ error: { code: "INTERNAL", message: "Processing failed" } }, { status: 500 });
  }
}
