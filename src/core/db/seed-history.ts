// Demo history (spec §16.1): two weeks of realistic activity produced by the REAL services on a moving
// clock, so dashboards, analytics, trust scores and dispute precedents are non-empty and internally
// consistent (every row has a ledger entry, attestation chain and audit trail).
import { MockPayPalAdapter } from "@/core/adapters/paypal/mock";
import { createStubLlm } from "@/core/agents/stub-fixtures";
import { scopeJob } from "@/core/agents/scoping";
import { makeSamplePhoto, offsetPoint } from "@/core/checks/sample-photos";
import type { AppConfig } from "@/core/config";
import { createContainer, type Container } from "@/core/container";
import type { AcceptanceCriterion, JobSpec } from "@/core/contracts";
import { sql } from "drizzle-orm";
import type { DbHandle } from "./client";
import { PROCUREBOT_CLIENT_ID } from "./seed-demo";

const DAY = 24 * 3600_000;

const REQUESTS: { text: string; worker: "usr_asha" | "usr_dev"; outcome: "paid" | "partial_dispute" | "unsupported_dispute" | "fraud" | "review_pending"; agent?: boolean }[] = [
  { text: "Deliver 12 cartons of tea from Rajwada to my shop in Vijay Nagar by evening. Budget $60.", worker: "usr_asha", outcome: "paid" },
  { text: "Deliver 30 boxes of biscuits from Bhawarkuan to Vijay Nagar today. Budget $90.", worker: "usr_asha", outcome: "paid" },
  { text: "Deliver 8 sacks of sugar from Rajwada to Palasia this afternoon. Budget $45.", worker: "usr_dev", outcome: "paid" },
  { text: "Deliver 20 cartons of tea from Rajwada to Vijay Nagar. Budget $100.", worker: "usr_asha", outcome: "partial_dispute" },
  { text: "Deliver 15 crates of soft drinks from Bhawarkuan to Palasia. Budget $70.", worker: "usr_asha", outcome: "paid", agent: true },
  { text: "Deliver 10 cartons of snacks from Rajwada to Vijay Nagar. Budget $50.", worker: "usr_dev", outcome: "fraud" },
  { text: "Deliver 25 cartons of tea from Rajwada to Vijay Nagar. Budget $110.", worker: "usr_asha", outcome: "paid", agent: true },
  { text: "Deliver 6 boxes of spices from Palasia to Vijay Nagar. Budget $40.", worker: "usr_asha", outcome: "unsupported_dispute" },
  { text: "Deliver 18 cartons of tea from Rajwada to Palasia. Budget $80.", worker: "usr_asha", outcome: "paid" },
  { text: "Deliver 40 packets of rice from Bhawarkuan to Vijay Nagar. Budget $95.", worker: "usr_asha", outcome: "paid", agent: true },
  { text: "Deliver 10 boxes of tea from Rajwada to Vijay Nagar. Budget $55.", worker: "usr_dev", outcome: "paid" },
  { text: "Deliver 14 cartons of oil from Rajwada to Palasia. Budget $75.", worker: "usr_asha", outcome: "review_pending" },
];

async function photoFor(c: Container, milestoneId: string, spec: JobSpec, seq: number, seed: string, opts: { noExif?: boolean } = {}) {
  const ms = spec.milestones.find((m) => m.seq === seq)!;
  const geo = ms.acceptanceCriteria.find((x: AcceptanceCriterion) => x.evidenceType === "geo");
  const target = geo?.params?.location ?? spec.location!;
  return makeSamplePhoto({
    seed,
    caption: `${ms.title}: ${spec.title}`.slice(0, 60),
    takenAt: opts.noExif ? undefined : new Date(c.clock.now().getTime() - 3 * 60_000),
    location: opts.noExif ? undefined : offsetPoint(target, 20),
  });
}

export async function seedHistory(cfg: AppConfig, dbHandle: DbHandle): Promise<number> {
  const { FixedClock } = await import("@/core/ports/clock");
  const clock = new FixedClock(new Date(Date.now() - 14 * DAY));
  const paypal = new MockPayPalAdapter({
    idTag: `H${Math.random().toString(36).slice(2, 5).toUpperCase()}-`,
    // History on a LIVE deployment shows the same fees and ledger entries that real jobs will.
    fees: cfg.fees.processingBps ? { captureBps: cfg.fees.processingBps, captureFixedMinor: cfg.fees.processingFixedMinor, payoutMinor: cfg.fees.payoutItemFeeMinor } : undefined,
  });
  const c = await createContainer({ ...cfg, CHALLENGE_WINDOW_SECONDS: 3600, DISPUTE_EVIDENCE_WINDOW_SECONDS: 3600 }, { dbHandle, clock, payments: paypal, llm: createStubLlm() });
  const db = dbHandle.db;

  // History is back-dated, but keys are created now. Create every key the history will use, then date
  // them before the history window so receipts for these jobs pass the verifier's key-validity check.
  for (const [type, id] of [["user", "usr_ravi"], ["user", "usr_asha"], ["user", "usr_dev"], ["client", PROCUREBOT_CLIENT_ID]] as const) {
    await c.keys.ensureManagedKey(type, id);
  }
  await db.execute(sql`update signing_keys set created_at = ${new Date(Date.now() - 15 * DAY)} where created_at > ${new Date(Date.now() - DAY)}`);

  // A past mandate for ProcureBot, valid for the history window only (it shows as expired today).
  const keyId = await c.keys.ensureManagedKey("user", "usr_ravi");
  const { payload } = await c.mandates.draftIntent({
    issuerUserId: "usr_ravi",
    keyId,
    agentClientId: PROCUREBOT_CLIENT_ID,
    categories: ["delivery"],
    maxPerJobMinor: 15000,
    maxTotalMinor: 60000,
    maxJobsPerDay: 5,
    ttlSeconds: 11 * 24 * 3600,
    geoFence: { lat: 22.7196, lng: 75.8577, radiusKm: 25, label: "Indore" },
    minTrustScore: 30,
    requirePayPalEmail: true,
    prohibitedKeywords: ["gift card", "crypto", "cash"],
    stepUpAboveMinor: 15000,
    maxAutoReleaseMinor: 15000,
    maxChallengeWindowSeconds: 86400,
  });
  const pastMandate = await c.mandates.createIntent({ userId: "usr_ravi", payload, jws: await c.mandates.signWithManagedKey("usr_ravi", payload) });

  // An agent overreach that the Mandate Guard refused (shows up as a denial in the dashboards).
  clock.set(new Date(Date.now() - 9 * DAY + 4 * 3600_000));
  await c.agentJobs.create({ clientId: PROCUREBOT_CLIENT_ID, mandateId: pastMandate.id, description: "Buy gift card codes for staff and repair the office AC", budgetMinor: 50000, requestNonce: `hist_denied_${Date.now()}` });

  let firstPhoto: Uint8Array | null = null;
  let created = 0;
  for (const [i, r] of REQUESTS.entries()) {
    clock.set(new Date(Date.now() - (13 - i) * DAY));
    let jobId: string;
    let spec: JobSpec;
    if (r.agent) {
      const res = await c.agentJobs.create({ clientId: PROCUREBOT_CLIENT_ID, mandateId: pastMandate.id, description: r.text.replace(/ Budget \$\d+\./, ""), budgetMinor: Number(/\$(\d+)/.exec(r.text)![1]) * 100, requestNonce: `hist_req_${i}_${Date.now()}` });
      if (!res.ok) continue;
      jobId = res.job.id;
      spec = res.spec;
    } else {
      const scoped = await scopeJob({ db, llm: c.llm }, { text: r.text, payerId: "usr_ravi", now: clock.now(), entityId: `hist_${i}` });
      if (!scoped.ok) continue;
      spec = scoped.output;
      jobId = (await c.jobs.createFromSpec({ payerId: "usr_ravi", spec, createdBy: "user:usr_ravi" })).id;
    }
    const order = await c.funding.start({ jobId, payerId: "usr_ravi" });
    paypal.approveOrder(order.orderId);
    await c.funding.capture({ jobId, payerId: "usr_ravi", orderId: order.orderId });
    await c.deliverMockWebhooks();
    clock.advance(20 * 60_000);
    await c.jobs.accept({ jobId, workerId: r.worker });
    created++;

    for (const seq of [1, 2]) {
      clock.advance(50 * 60_000);
      const ms = (await c.jobs.detail(jobId))!.milestones.find((m) => m.seq === seq)!;
      if (ms.status !== "ACTIVE") break;
      const fraud = r.outcome === "fraud" && seq === 1;
      const pending = r.outcome === "review_pending" && seq === 2;
      const bytes: Uint8Array = fraud && firstPhoto ? firstPhoto : await photoFor(c, ms.id, spec, seq, `hist-${i}-${seq}`, { noExif: pending });
      if (!firstPhoto) firstPhoto = bytes;
      await c.proofs.addPhoto({ milestoneId: ms.id, workerId: r.worker, bytes, declaredMime: "image/jpeg" });
      if (ms.criteriaJson && (ms.criteriaJson as AcceptanceCriterion[]).some((x) => x.evidenceType === "text")) {
        await c.proofs.addText({ milestoneId: ms.id, workerId: r.worker, text: "Received by Mr. Sharma at the counter" });
      }
      await c.proofs.submit({ milestoneId: ms.id, workerId: r.worker });
      const card = await c.verification.run(ms.id);

      if (fraud && card?.decision === "HOLD") {
        await c.releases.reject({ milestoneId: ms.id, adminId: "usr_meera", reason: "Photo reused from an earlier delivery" });
        break;
      }
      if (pending) break; // stays in the admin's review queue
      if (card?.decision === "AUTO_RELEASE") {
        const dispute = (r.outcome === "partial_dispute" || r.outcome === "unsupported_dispute") && seq === 2;
        if (dispute) {
          const d = await c.disputes.open({ milestoneId: ms.id, userId: "usr_ravi", reason: r.outcome === "partial_dispute" ? "Some cartons were damaged" : "Arrived late" });
          if (r.outcome === "partial_dispute") await c.disputes.addEvidence({ disputeId: d.id, userId: "usr_ravi", text: "5 of 20 cartons were crushed and unusable" });
          await c.disputes.addEvidence({ disputeId: d.id, userId: r.worker, text: "Everything was sealed and intact at pickup" });
          await c.disputes.proposeNow({ disputeId: d.id, userId: "usr_ravi" });
          await c.disputes.respond({ disputeId: d.id, userId: "usr_ravi", accept: true });
          await c.disputes.respond({ disputeId: d.id, userId: r.worker, accept: true });
          break;
        }
        clock.advance(61 * 60_000);
        await c.releases.processDueWindows();
      } else if (card) {
        await c.releases.approve({ milestoneId: ms.id, adminId: "usr_meera", note: "Confirmed with the shop by phone" });
      }
    }
  }
  return created;
}
