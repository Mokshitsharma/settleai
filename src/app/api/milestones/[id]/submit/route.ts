import { getContainer } from "@/core/container";
import { handle, requireUser } from "../../../_lib";

/** Finalize the submission; verification runs in the background and streams to the job's activity feed. */
export const POST = handle(async (_req: Request, ctx: RouteContext<"/api/milestones/[id]/submit">) => {
  const user = await requireUser(["worker"]);
  const { id } = await ctx.params;
  const c = await getContainer();
  await c.proofs.submit({ milestoneId: id, workerId: user.id });
  c.verifyInBackground(id);
  return Response.json({ ok: true });
});
