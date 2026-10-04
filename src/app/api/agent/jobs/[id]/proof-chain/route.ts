import { agentRoute } from "../../../_agent";

export const dynamic = "force-dynamic";
export const GET = agentRoute(async (api, _req, ctx: RouteContext<"/api/agent/jobs/[id]/proof-chain">, baseUrl) => api.getProofChain((await ctx.params).id, baseUrl));
