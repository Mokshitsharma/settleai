import { getContainer } from "@/core/container";
import { handle, requireUser } from "../../../_lib";

/** Payer cancels a paused milestone; its amount goes back through a PayPal refund. */
export const POST = handle(async (_req: Request, ctx: RouteContext<"/api/milestones/[id]/cancel">) => {
  const user = await requireUser(["payer"]);
  const { id } = await ctx.params;
  const c = await getContainer();
  await c.releases.cancelPaused({ milestoneId: id, payerId: user.id });
  await c.deliverMockWebhooks();
  return Response.json({ ok: true });
});
