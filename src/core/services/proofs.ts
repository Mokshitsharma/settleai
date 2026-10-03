// Proof submission (spec F05): photos are ingested (hashes, EXIF, MIME sniffing) and re-encoded before
// storage; text and device location are stored as separate proofs. Every proof is an evidence attestation.
import { and, asc, desc, eq, gt } from "drizzle-orm";
import type { Db } from "@/core/db/client";
import { jobs, milestones, proofs, riskAssessments } from "@/core/db/schema";
import type { JobSpec } from "@/core/contracts";
import { fallbackOffsetFor, ingestImage } from "@/core/checks/image";
import type { EventHub } from "@/core/events/hub";
import { newId } from "@/core/ids";
import type { ClockPort } from "@/core/ports/clock";
import type { StoragePort } from "@/core/ports/storage";
import { assertTransition } from "@/core/state/machines";
import type { AttestationService } from "./attestations";
import type { AuditService } from "./audit";
import { JobError } from "./jobs";

export type ProofRow = typeof proofs.$inferSelect;

export class ProofService {
  constructor(
    private readonly db: Db,
    private readonly storage: StoragePort,
    private readonly attestations: AttestationService,
    private readonly audit: AuditService,
    private readonly events: EventHub,
    private readonly clock: ClockPort,
  ) {}

  /** Loads the milestone for its assigned worker; a rejected milestone re-opens for a new submission. */
  private async openMilestone(milestoneId: string, workerId: string) {
    const [ms] = await this.db.select().from(milestones).where(eq(milestones.id, milestoneId));
    if (!ms) throw new JobError("NOT_FOUND", "Milestone not found");
    const [job] = await this.db.select().from(jobs).where(eq(jobs.id, ms.jobId));
    if (job.workerId !== workerId) throw new JobError("FORBIDDEN", "Only the assigned worker can submit proof");
    if (ms.status === "REJECTED") {
      assertTransition("MILESTONE", "REJECTED", "ACTIVE");
      await this.db.update(milestones).set({ status: "ACTIVE", updatedAt: this.clock.now() }).where(eq(milestones.id, ms.id));
      ms.status = "ACTIVE";
    }
    if (ms.status !== "ACTIVE") throw new JobError("INVALID_STATE", `Milestone is ${ms.status}; proof can only be added while it is active`);
    return { ms, job };
  }

  async addPhoto(args: { milestoneId: string; workerId: string; bytes: Uint8Array; declaredMime: string; source?: "upload" | "demo_sample" }): Promise<ProofRow> {
    const { ms, job } = await this.openMilestone(args.milestoneId, args.workerId);
    const spec = job.specJson as JobSpec;
    let img;
    try {
      img = await ingestImage(args.bytes, { fallbackOffset: fallbackOffsetFor(spec.location) });
    } catch (err) {
      throw new JobError("INVALID_SPEC", `That file could not be read as an image (${(err as Error).message})`);
    }
    const id = newId("prf");
    const storageKey = `proofs/${job.id}/${ms.id}/${id}.jpg`;
    await this.storage.put(storageKey, img.stored, "image/jpeg");
    const exifJson = { ...img.exif, width: img.width, height: img.height, declaredMime: args.declaredMime, source: args.source ?? "upload" };
    await this.db.transaction(async (tx) => {
      await tx.insert(proofs).values({
        id,
        milestoneId: ms.id,
        submitterId: args.workerId,
        kind: "photo",
        storageKey,
        mime: img.sniffedMime,
        sha256: img.sha256,
        phash: img.phash,
        exifJson,
        geoLat: img.exif.lat ?? null,
        geoLng: img.exif.lng ?? null,
      });
      await this.attestations.append(
        {
          jobId: job.id,
          type: "evidence",
          subjectId: id,
          payload: { kind: "photo", milestoneSeq: ms.seq, sha256: img.sha256, phash: img.phash, takenAt: img.exif.takenAt ?? null, hasGps: img.exif.lat !== undefined, source: args.source ?? "upload" },
        },
        tx,
      );
    });
    this.events.publish(`job:${job.id}`, "proof.added", `Photo received for milestone ${ms.seq}${img.exif.takenAt ? " with capture time" : ""}${img.exif.lat !== undefined ? " and GPS" : ""}`);
    return (await this.db.select().from(proofs).where(eq(proofs.id, id)))[0];
  }

  async addText(args: { milestoneId: string; workerId: string; text: string }): Promise<ProofRow> {
    const { ms, job } = await this.openMilestone(args.milestoneId, args.workerId);
    const id = newId("prf");
    const text = args.text.trim().slice(0, 2000);
    await this.db.transaction(async (tx) => {
      await tx.insert(proofs).values({ id, milestoneId: ms.id, submitterId: args.workerId, kind: "text", textContent: text });
      await this.attestations.append({ jobId: job.id, type: "evidence", subjectId: id, payload: { kind: "text", milestoneSeq: ms.seq, length: text.length } }, tx);
    });
    return (await this.db.select().from(proofs).where(eq(proofs.id, id)))[0];
  }

  async addGeo(args: { milestoneId: string; workerId: string; lat: number; lng: number; accuracyM?: number }): Promise<ProofRow> {
    const { ms, job } = await this.openMilestone(args.milestoneId, args.workerId);
    const id = newId("prf");
    await this.db.transaction(async (tx) => {
      await tx.insert(proofs).values({
        id,
        milestoneId: ms.id,
        submitterId: args.workerId,
        kind: "geo",
        geoLat: args.lat,
        geoLng: args.lng,
        exifJson: { accuracyM: args.accuracyM ?? null, source: "browser_geolocation" },
      });
      await this.attestations.append({ jobId: job.id, type: "evidence", subjectId: id, payload: { kind: "geo", milestoneSeq: ms.seq, accuracyM: args.accuracyM ?? null } }, tx);
    });
    return (await this.db.select().from(proofs).where(eq(proofs.id, id)))[0];
  }

  /** Proofs of the current submission round (after the last decision, so a resubmission starts clean). */
  async currentRound(milestoneId: string): Promise<ProofRow[]> {
    const [last] = await this.db
      .select({ at: riskAssessments.createdAt })
      .from(riskAssessments)
      .where(eq(riskAssessments.milestoneId, milestoneId))
      .orderBy(desc(riskAssessments.createdAt))
      .limit(1);
    return this.db
      .select()
      .from(proofs)
      .where(last ? and(eq(proofs.milestoneId, milestoneId), gt(proofs.createdAt, last.at)) : eq(proofs.milestoneId, milestoneId))
      .orderBy(asc(proofs.createdAt));
  }

  async submit(args: { milestoneId: string; workerId: string }): Promise<void> {
    const { ms, job } = await this.openMilestone(args.milestoneId, args.workerId);
    const round = await this.currentRound(ms.id);
    if (!round.some((p) => p.kind === "photo" || p.kind === "file" || p.kind === "text")) {
      throw new JobError("INVALID_STATE", "Add at least one photo, file or confirmation before submitting");
    }
    await this.db.transaction(async (tx) => {
      assertTransition("MILESTONE", ms.status, "SUBMITTED");
      await tx.update(milestones).set({ status: "SUBMITTED", updatedAt: this.clock.now() }).where(eq(milestones.id, ms.id));
      await this.audit.append(
        { actor: `user:${args.workerId}`, action: "milestone.submitted", entityType: "milestone", entityId: ms.id, payload: { proofIds: round.map((p) => p.id) } },
        tx,
      );
    });
    this.events.publish(`job:${job.id}`, "milestone.submitted", `Worker submitted proof for milestone ${ms.seq}; verification starting`);
  }
}
