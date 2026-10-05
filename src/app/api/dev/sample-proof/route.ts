import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
import { z } from "zod";
import type { AcceptanceCriterion, JobSpec } from "@/core/contracts";
import { makeSamplePhoto, offsetPoint } from "@/core/checks/sample-photos";
import { getContainer } from "@/core/container";
import { jobs, milestones, proofs } from "@/core/db/schema";
import { HttpError, handle, limit, readJson, requireUser } from "../../_lib";

/**
 * Demo samples for judges without a phone at the job site. Each is a generated photo with real EXIF,
 * clearly marked as a demo sample on the proof. Variants exercise the real checks:
 *  genuine  - taken now, at the right place
 *  far      - taken now, about 5 km away
 *  reused   - the most recent photo from a different job, submitted again
 *  noexif   - no capture time or location
 */
export const POST = handle(async (req: Request) => {
  const user = await requireUser(["worker"]);
  limit(req, "write", user.id);
  const { milestoneId, variant } = await readJson(req, z.object({ milestoneId: z.string(), variant: z.enum(["genuine", "far", "reused", "noexif"]) }));
  const c = await getContainer();
  const db = c.dbHandle.db;
  const [ms] = await db.select().from(milestones).where(eq(milestones.id, milestoneId));
  if (!ms) throw new HttpError(404, "NOT_FOUND", "Milestone not found");
  const [job] = await db.select().from(jobs).where(eq(jobs.id, ms.jobId));
  const spec = job.specJson as JobSpec;
  const geo = (ms.criteriaJson as AcceptanceCriterion[]).find((x) => x.evidenceType === "geo");
  const target = geo?.params?.location ?? spec.location ?? { lat: 22.7196, lng: 75.8577 };
  const takenAt = new Date(c.clock.now().getTime() - 90_000);

  let bytes: Uint8Array;
  if (variant === "reused") {
    const [prior] = await db
      .select({ key: proofs.storageKey })
      .from(proofs)
      .innerJoin(milestones, eq(milestones.id, proofs.milestoneId))
      .where(and(ne(milestones.jobId, job.id), isNotNull(proofs.storageKey), eq(proofs.kind, "photo")))
      .orderBy(desc(proofs.createdAt))
      .limit(1);
    if (!prior?.key) throw new HttpError(409, "NO_PRIOR_PHOTO", "There is no photo from another job to reuse yet. Complete one job first.");
    bytes = await c.storage.get(prior.key);
  } else {
    bytes = await makeSamplePhoto({
      seed: `${ms.id}-${variant}-${Date.now()}`,
      caption: `${ms.title}: ${spec.title}`.slice(0, 60),
      takenAt: variant === "noexif" ? undefined : takenAt,
      location: variant === "noexif" ? undefined : variant === "far" ? offsetPoint(target, 5000) : offsetPoint(target, 25),
    });
  }
  const proof = await c.proofs.addPhoto({ milestoneId, workerId: user.id, bytes, declaredMime: "image/jpeg", source: "demo_sample" });
  return Response.json({ proofId: proof.id });
});
