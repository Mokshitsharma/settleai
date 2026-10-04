import { z } from "zod";
import { agentRoute, body } from "../../../_agent";

export const POST = agentRoute(async (api, req, ctx: RouteContext<"/api/agent/milestones/[id]/dispute">) => {
  const { reason } = z.object({ reason: z.string().trim().min(5).max(1000) }).parse(await body(req));
  return api.requestDispute((await ctx.params).id, reason);
});
