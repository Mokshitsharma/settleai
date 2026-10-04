import { agentRoute } from "../../_agent";

export const dynamic = "force-dynamic";
export const GET = agentRoute(async (api, _req, ctx: RouteContext<"/api/agent/mandates/[id]">) => api.getMandate((await ctx.params).id));
