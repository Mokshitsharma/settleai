import { getContainer } from "@/core/container";
import { handle, requireUser } from "../../../_lib";

export const POST = handle(async (_req: Request, ctx: RouteContext<"/api/jobs/[id]/accept">) => {
  const user = await requireUser(["worker"]);
  const { id } = await ctx.params;
  const c = await getContainer();
  return Response.json({ job: await c.jobs.accept({ jobId: id, workerId: user.id }) });
});
