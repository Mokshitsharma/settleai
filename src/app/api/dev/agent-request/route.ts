import { z } from "zod";
import { getContainer } from "@/core/container";
import { newId } from "@/core/ids";
import { HttpError, handle, readJson, requireUser } from "../../_lib";

/**
 * Demo: run a hire request exactly as the payer's agent would (same AgentJobService, same Mandate Guard),
 * so the denial and the created job can be shown before the MCP server ships (T303).
 */
export const POST = handle(async (req: Request) => {
  const user = await requireUser(["payer"]);
  const body = await readJson(req, z.object({ mandateId: z.string(), description: z.string().trim().min(10).max(1000), budgetMinor: z.number().int().positive() }));
  const c = await getContainer();
  const m = await c.mandates.get(body.mandateId);
  if (!m || m.envelope.payload.type !== "intent" || m.envelope.payload.issuer.userId !== user.id) throw new HttpError(404, "NOT_FOUND", "Mandate not found");
  const result = await c.agentJobs.create({
    clientId: m.envelope.payload.agent.clientId,
    mandateId: body.mandateId,
    description: body.description,
    budgetMinor: body.budgetMinor,
    requestNonce: newId("req"),
  });
  return Response.json(result.ok ? { ok: true, jobId: result.job.id, decision: result.decision } : { ok: false, decision: result.decision, stage: result.stage });
});
