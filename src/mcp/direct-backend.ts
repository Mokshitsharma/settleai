// In-process backend for the MCP server: routes the same paths as /api/agent/* straight to AgentApi.
// Used by tests and local demos; production uses httpBackend so every call crosses the server boundary.
import type { AgentApi } from "@/core/agent-api";
import type { SettleBackend } from "./server";

export function directBackend(api: AgentApi, baseUrl = "http://localhost:3000"): SettleBackend {
  return {
    async call(method, path, body) {
      const [route, query] = path.split("?");
      const parts = route.split("/").filter(Boolean).map(decodeURIComponent);
      const q = new URLSearchParams(query ?? "");
      const [a, id, sub] = parts;
      if (method === "GET" && a === "mandates" && !id) return api.listMandates();
      if (method === "GET" && a === "mandates" && id && !sub) return api.getMandate(id);
      if (method === "POST" && a === "mandates" && sub === "check") return api.checkAction({ ...(body as object), mandateId: id });
      if (method === "GET" && a === "jobs" && !id) return api.listJobs(q.get("status") ?? undefined);
      if (method === "POST" && a === "jobs" && !id) return api.createJob(body);
      if (method === "GET" && a === "jobs" && id && !sub) return api.getJobStatus(id);
      if (method === "POST" && a === "jobs" && sub === "confirm") return api.confirmJob(id, baseUrl);
      if (method === "GET" && a === "jobs" && sub === "proof-chain") return api.getProofChain(id, baseUrl);
      if (method === "GET" && a === "milestones" && sub === "decision") return api.getDecision(id);
      if (method === "POST" && a === "milestones" && sub === "dispute") return api.requestDispute(id, (body as { reason: string }).reason);
      throw new Error(`No agent route for ${method} ${path}`);
    },
  };
}
