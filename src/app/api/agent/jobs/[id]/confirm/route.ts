import { agentRoute } from "../../../_agent";

export const POST = agentRoute(async (api, _req, ctx: RouteContext<"/api/agent/jobs/[id]/confirm">, baseUrl) => api.confirmJob((await ctx.params).id, baseUrl));
