import { agentRoute } from "../../../_agent";

export const dynamic = "force-dynamic";
export const GET = agentRoute(async (api, _req, ctx: RouteContext<"/api/agent/milestones/[id]/decision">) => api.getDecision((await ctx.params).id));
