import { z } from "zod";
import { getContainer } from "@/core/container";
import { handle, readJson, requireUser } from "../../../_lib";

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/milestones/[id]/reject">) => {
  const user = await requireUser(["admin"]);
  const { id } = await ctx.params;
  const { reason } = await readJson(req, z.object({ reason: z.string().trim().min(3).max(500) }));
  const c = await getContainer();
  await c.releases.reject({ milestoneId: id, adminId: user.id, reason });
  return Response.json({ ok: true });
});
