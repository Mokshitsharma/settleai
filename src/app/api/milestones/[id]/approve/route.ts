import { z } from "zod";
import { getContainer } from "@/core/container";
import { handle, readJson, requireUser } from "../../../_lib";

/** Admin approves a milestone waiting for review or on hold (attested override), then pays out. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/milestones/[id]/approve">) => {
  const user = await requireUser(["admin"]);
  const { id } = await ctx.params;
  const { note } = await readJson(req, z.object({ note: z.string().trim().min(3).max(500) }));
  const c = await getContainer();
  await c.releases.approve({ milestoneId: id, adminId: user.id, note });
  await c.deliverMockWebhooks();
  return Response.json({ ok: true });
});
