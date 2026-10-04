import { agentRoute, body } from "../_agent";

export const dynamic = "force-dynamic";
export const GET = agentRoute((api, req) => api.listJobs(new URL(req.url).searchParams.get("status") ?? undefined));
export const POST = agentRoute(async (api, req) => api.createJob(await body(req)));
