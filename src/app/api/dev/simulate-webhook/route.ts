import { MockPayPalAdapter } from "@/core/adapters/paypal/mock";
import { getContainer } from "@/core/container";
import { HttpError, handle, requireUser } from "../../_lib";

/** MOCK mode only (spec §6.6): deliver queued mock PayPal events through the real webhook pipeline. */
export const POST = handle(async () => {
  await requireUser(["admin"]);
  const c = await getContainer();
  if (!(c.payments instanceof MockPayPalAdapter)) throw new HttpError(404, "NOT_FOUND", "Only available in MOCK mode");
  return Response.json({ delivered: await c.deliverMockWebhooks() });
});
