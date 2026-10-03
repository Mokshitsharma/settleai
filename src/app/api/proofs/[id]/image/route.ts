import { eq } from "drizzle-orm";
import { getContainer } from "@/core/container";
import { jobs, milestones, proofs } from "@/core/db/schema";
import { HttpError, handle, requireUser } from "../../../_lib";

/** Proof photo for the job's parties and admins only (EXIF GPS is never shown publicly). */
export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/proofs/[id]/image">) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const c = await getContainer();
  const [row] = await c.dbHandle.db
    .select({ p: proofs, job: jobs })
    .from(proofs)
    .innerJoin(milestones, eq(milestones.id, proofs.milestoneId))
    .innerJoin(jobs, eq(jobs.id, milestones.jobId))
    .where(eq(proofs.id, id));
  if (!row?.p.storageKey) throw new HttpError(404, "NOT_FOUND", "No image for this proof");
  if (user.role !== "admin" && row.job.payerId !== user.id && row.job.workerId !== user.id) throw new HttpError(403, "FORBIDDEN", "Not your job");
  const bytes = await c.storage.get(row.p.storageKey);
  return new Response(Buffer.from(bytes), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=3600" } });
});
