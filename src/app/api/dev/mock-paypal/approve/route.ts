import { z } from "zod";
import { MockPayPalAdapter } from "@/core/adapters/paypal/mock";
import { getContainer } from "@/core/container";
import { HttpError, handle, readJson, requireUser } from "../../../_lib";

/** MOCK mode only: the fake PayPal approval dialog calls this when the buyer clicks "Pay". */
export const POST = handle(async (req: Request) => {
  await requireUser(["payer"]);
  const c = await getContainer();
  if (!(c.payments instanceof MockPayPalAdapter)) throw new HttpError(404, "NOT_FOUND", "Only available in MOCK mode");
  const { orderId } = await readJson(req, z.object({ orderId: z.string().min(1) }));
  c.payments.approveOrder(orderId);
  return Response.json({ ok: true });
});
