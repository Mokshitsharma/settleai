import { getContainer } from "@/core/container";
import { handle, requireUser } from "../../../_lib";

/** Create (or reuse) the PayPal order that funds escrow. */
export const POST = handle(async (_req: Request, ctx: RouteContext<"/api/jobs/[id]/fund">) => {
  const user = await requireUser(["payer"]);
  const { id } = await ctx.params;
  const c = await getContainer();
  const order = await c.funding.start({ jobId: id, payerId: user.id });
  return Response.json({ ...order, mode: c.payments.mode });
});
