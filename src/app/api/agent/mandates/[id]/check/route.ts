import { agentRoute, body } from "../../../_agent";

export const POST = agentRoute(async (api, req, ctx: RouteContext<"/api/agent/mandates/[id]/check">) => {
  const b = (await body(req)) as Record<string, unknown>;
  return api.checkAction({ ...b, mandateId: (await ctx.params).id });
});
