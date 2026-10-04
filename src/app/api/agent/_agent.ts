import { z } from "zod";
import { AgentApi, AgentApiError, authenticateAgent } from "@/core/agent-api";
import { getContainer } from "@/core/container";
import { errorResponse } from "../_lib";

/** Agent route wrapper: Bearer API key auth, typed errors, and the public base URL for links. */
export function agentRoute<C>(fn: (api: AgentApi, req: Request, ctx: C, baseUrl: string) => Promise<unknown>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    try {
      const c = await getContainer();
      const client = await authenticateAgent(c, req.headers.get("authorization"));
      const baseUrl = new URL(req.url).origin;
      return Response.json(await fn(new AgentApi(c, client), req, ctx, baseUrl));
    } catch (err) {
      if (err instanceof AgentApiError) return Response.json({ error: { code: err.code, message: err.message } }, { status: err.status });
      if (err instanceof z.ZodError) return Response.json({ error: { code: "VALIDATION", message: err.issues[0]?.message ?? "Invalid request" } }, { status: 400 });
      return errorResponse(err);
    }
  };
}

export async function body(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AgentApiError(400, "INVALID_JSON", "Request body must be JSON");
  }
}
