import { getContainer } from "@/core/container";
import { handle, requireUser } from "../../../_lib";

/** A party asks the Arbiter to decide now instead of waiting for the evidence window to close. */
export const POST = handle(async (_req: Request, ctx: RouteContext<"/api/disputes/[id]/propose">) => {
  const user = await requireUser(["payer", "worker"]);
  const { id } = await ctx.params;
  const c = await getContainer();
  await c.disputes.proposeNow({ disputeId: id, userId: user.id });
  return Response.json({ ok: true });
});
