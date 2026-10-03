import { getContainer } from "@/core/container";
import { handle, requireUser } from "../../../_lib";

/** Payer approves completion in person after the agent's mandate was revoked. */
export const POST = handle(async (_req: Request, ctx: RouteContext<"/api/milestones/[id]/resume">) => {
  const user = await requireUser(["payer"]);
  const { id } = await ctx.params;
  const c = await getContainer();
  await c.releases.resumePaused({ milestoneId: id, payerId: user.id });
  await c.deliverMockWebhooks();
  return Response.json({ ok: true });
});
