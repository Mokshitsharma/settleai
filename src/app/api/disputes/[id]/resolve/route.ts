import { z } from "zod";
import { getContainer } from "@/core/container";
import { FaultClass } from "@/core/contracts";
import { handle, readJson, requireUser } from "../../../_lib";

/** Admin decides an escalated dispute; the decision and reason are attested in the proof chain. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/disputes/[id]/resolve">) => {
  const user = await requireUser(["admin"]);
  const { id } = await ctx.params;
  const body = await readJson(req, z.object({ releaseToWorkerMinor: z.number().int().nonnegative(), faultClass: FaultClass, note: z.string().trim().min(3).max(500) }));
  const c = await getContainer();
  await c.disputes.adminResolve({ disputeId: id, adminId: user.id, ...body });
  await c.deliverMockWebhooks();
  return Response.json({ ok: true });
});
