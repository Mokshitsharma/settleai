import { getContainer } from "@/core/container";
import { HttpError, handle, requireUser } from "../../_lib";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/jobs/[id]">) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const c = await getContainer();
  const detail = await c.jobs.detail(id);
  if (!detail) throw new HttpError(404, "NOT_FOUND", "Job not found");
  const { job } = detail;
  const visible =
    user.role === "admin" || job.payerId === user.id || job.workerId === user.id || (user.role === "worker" && job.status === "FUNDED");
  if (!visible) throw new HttpError(403, "FORBIDDEN", "Not your job");
  return Response.json(detail);
});
