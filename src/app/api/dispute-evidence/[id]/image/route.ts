import { eq } from "drizzle-orm";
import { getContainer } from "@/core/container";
import { disputeEvidence, disputes, jobs, milestones } from "@/core/db/schema";
import { HttpError, handle, requireUser } from "../../../_lib";

/** Dispute evidence photo, for the job's parties and admins only. */
export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/dispute-evidence/[id]/image">) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const c = await getContainer();
  const [row] = await c.dbHandle.db
    .select({ e: disputeEvidence, job: jobs })
    .from(disputeEvidence)
    .innerJoin(disputes, eq(disputes.id, disputeEvidence.disputeId))
    .innerJoin(milestones, eq(milestones.id, disputes.milestoneId))
    .innerJoin(jobs, eq(jobs.id, milestones.jobId))
    .where(eq(disputeEvidence.id, id));
  if (!row?.e.storageKey) throw new HttpError(404, "NOT_FOUND", "No image for this evidence");
  if (user.role !== "admin" && row.job.payerId !== user.id && row.job.workerId !== user.id) throw new HttpError(403, "FORBIDDEN", "Not your job");
  return new Response(Buffer.from(await c.storage.get(row.e.storageKey)), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=3600" } });
});
