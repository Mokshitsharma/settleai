import { agentRoute } from "../_agent";

export const dynamic = "force-dynamic";
export const GET = agentRoute((api) => api.listMandates());
