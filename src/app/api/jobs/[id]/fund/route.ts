import { getContainer } from "@/core/container";
import { handle, requireUser } from "../../../_lib";

/** Create (or reuse) the PayPal order that funds escrow. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/jobs/[id]/fund">) => {
  const user = await requireUser(["payer"]);
  const { id } = await ctx.params;
  const c = await getContainer();
  // The public URL, not the request's: behind Render's proxy the request origin can be internal.
  const baseUrl = c.config.APP_URL ?? process.env.RENDER_EXTERNAL_URL ?? new URL(req.url).origin;
  const order = await c.funding.start({ jobId: id, payerId: user.id, baseUrl });
  return Response.json({ ...order, mode: c.payments.mode });
});
