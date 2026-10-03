import { z } from "zod";
import { getContainer } from "@/core/container";
import { handle, readJson, requireUser } from "../../../_lib";

export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/jobs/[id]/spec">) => {
  const user = await requireUser(["payer"]);
  const { id } = await ctx.params;
  const { spec } = await readJson(req, z.object({ spec: z.unknown() }));
  const c = await getContainer();
  return Response.json({ job: await c.jobs.updateSpec({ jobId: id, payerId: user.id, spec }) });
});
