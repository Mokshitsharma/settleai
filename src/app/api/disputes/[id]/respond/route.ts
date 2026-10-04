import { z } from "zod";
import { getContainer } from "@/core/container";
import { handle, readJson, requireUser } from "../../../_lib";

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/disputes/[id]/respond">) => {
  const user = await requireUser(["payer", "worker"]);
  const { id } = await ctx.params;
  const { accept } = await readJson(req, z.object({ accept: z.boolean() }));
  const c = await getContainer();
  await c.disputes.respond({ disputeId: id, userId: user.id, accept });
  await c.deliverMockWebhooks();
  return Response.json({ ok: true });
});
