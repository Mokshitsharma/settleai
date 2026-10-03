import { z } from "zod";
import { guessCategory } from "@/core/agents/scoping";
import { getContainer } from "@/core/container";
import { Category } from "@/core/contracts";
import { HttpError, handle, readJson, requireUser } from "../../_lib";

/** Dry run of Mandate Guard G1: would this request be allowed? Records the check; reserves nothing. */
export const POST = handle(async (req: Request) => {
  const user = await requireUser(["payer"]);
  const body = await readJson(
    req,
    z.object({ mandateId: z.string(), description: z.string().trim().min(3).max(1000), amountMinor: z.number().int().positive(), category: Category.optional() }),
  );
  const c = await getContainer();
  const m = await c.mandates.get(body.mandateId);
  if (!m || m.envelope.payload.type !== "intent" || m.envelope.payload.issuer.userId !== user.id) throw new HttpError(404, "NOT_FOUND", "Mandate not found");
  const decision = await c.guard.g1CreateJob({
    mandateId: body.mandateId,
    clientId: m.envelope.payload.agent.clientId,
    category: body.category ?? guessCategory(body.description),
    text: body.description,
    amountMinor: body.amountMinor,
    dryRun: true,
  });
  return Response.json({ decision });
});
