import { z } from "zod";
import { getContainer } from "@/core/container";
import { handle, readJson, requireUser } from "../../../_lib";

/** Payer or worker opens a dispute; the milestone's payout freezes immediately. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/milestones/[id]/dispute">) => {
  const user = await requireUser(["payer", "worker"]);
  const { id } = await ctx.params;
  const { reason } = await readJson(req, z.object({ reason: z.string().trim().min(5).max(1000) }));
  const c = await getContainer();
  const dispute = await c.disputes.open({ milestoneId: id, userId: user.id, reason });
  return Response.json({ dispute }, { status: 201 });
});
