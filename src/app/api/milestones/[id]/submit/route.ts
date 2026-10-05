import { getContainer } from "@/core/container";
import { handle, limit, requireUser } from "../../../_lib";

/** Finalize the submission; verification runs in the background and streams to the job's activity feed. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/milestones/[id]/submit">) => {
  const user = await requireUser(["worker"]);
  limit(req, "llm", user.id);
  const { id } = await ctx.params;
  const c = await getContainer();
  await c.proofs.submit({ milestoneId: id, workerId: user.id });
  c.verifyInBackground(id);
  return Response.json({ ok: true });
});
