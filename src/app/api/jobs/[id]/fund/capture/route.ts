import { z } from "zod";
import { getContainer } from "@/core/container";
import { handle, readJson, requireUser } from "../../../../_lib";

/** Capture an approved order. In MOCK mode the mock's webhooks are delivered right after. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/jobs/[id]/fund/capture">) => {
  const user = await requireUser(["payer"]);
  const { id } = await ctx.params;
  const { orderId } = await readJson(req, z.object({ orderId: z.string().min(1) }));
  const c = await getContainer();
  const result = await c.funding.capture({ jobId: id, payerId: user.id, orderId });
  await c.deliverMockWebhooks();
  const job = await c.jobs.getRow(id);
  return Response.json({ ...result, jobStatus: job?.status });
});
