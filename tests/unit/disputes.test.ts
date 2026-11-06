// Journey J3 and Appendix B S14, S15, S26, S27-style escalation: disputes with liability findings.
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MockPayPalAdapter } from "@/core/adapters/paypal/mock";
import { citeMandateClauses, enforceProposal, type ArbiterInput, type ComplianceReport } from "@/core/agents/arbiter";
import { makeSamplePhoto } from "@/core/checks/sample-photos";
import { loadConfig } from "@/core/config";
import { createContainer, type Container } from "@/core/container";
import type { DisputeProposal } from "@/core/contracts";
import { openTestDb } from "@/core/db/client";
import { apiClients, milestones, users } from "@/core/db/schema";
import { seed } from "@/core/db/seed";
import { PROCUREBOT_CLIENT_ID, seedDemo } from "@/core/db/seed-demo";
import { FixedClock } from "@/core/ports/clock";
import { escrowCode } from "@/core/services/ledger";
import { sampleDisputeProposal, sampleJobSpec } from "../fixtures/contracts";
import { T0 } from "../helpers";

const SHOP = { lat: 22.7533, lng: 75.8937 };
let c: Container;
let mock: MockPayPalAdapter;
let clock: FixedClock;
let mandateId: string;

beforeAll(async () => {
  const dbHandle = await openTestDb();
  await seed(dbHandle.db);
  mock = new MockPayPalAdapter();
  clock = new FixedClock(T0);
  c = await createContainer(loadConfig({ CHALLENGE_WINDOW_SECONDS: "15", DISPUTE_EVIDENCE_WINDOW_SECONDS: "45" }), { dbHandle, clock, payments: mock });
  [mandateId] = (await seedDemo(c)).mandateIds;
});
afterAll(() => c.dbHandle.close());

/** A job whose milestone 1 was verified and is in its challenge window. */
async function inChallengeWindow(jobId?: string) {
  const id = jobId ?? (await c.jobs.createFromSpec({ payerId: "usr_ravi", spec: sampleJobSpec, createdBy: "user:usr_ravi" })).id;
  const order = await c.funding.start({ jobId: id, payerId: "usr_ravi" });
  mock.approveOrder(order.orderId);
  await c.funding.capture({ jobId: id, payerId: "usr_ravi", orderId: order.orderId });
  await c.deliverMockWebhooks();
  await c.jobs.accept({ jobId: id, workerId: "usr_asha" });
  clock.advance(10 * 60_000);
  const d = (await c.jobs.detail(id))!;
  const bytes = await makeSamplePhoto({ seed: `dispute-${id}`, caption: "x", takenAt: new Date(clock.now().getTime() - 60_000), location: SHOP });
  await c.proofs.addPhoto({ milestoneId: d.milestones[0].id, workerId: "usr_asha", bytes, declaredMime: "image/jpeg" });
  await c.proofs.submit({ milestoneId: d.milestones[0].id, workerId: "usr_asha" });
  const card = await c.verification.run(d.milestones[0].id);
  expect(card?.decision).toBe("AUTO_RELEASE");
  return { jobId: id, milestoneId: d.milestones[0].id };
}

const trust = async (id: string) => (await c.dbHandle.db.select().from(users).where(eq(users.id, id)))[0].trustScore;

describe("J3 disputes", () => {
  it("opening a dispute in the challenge window freezes the payout", async () => {
    const { jobId, milestoneId } = await inChallengeWindow();
    await c.disputes.open({ milestoneId, userId: "usr_ravi", reason: "Some cartons were crushed" });
    clock.advance(60_000);
    await c.releases.processDueWindows();
    const d = (await c.jobs.detail(jobId))!;
    expect(d.job.status).toBe("DISPUTED");
    expect(d.milestones[0].status).toBe("DISPUTED");
    expect(d.money.releasedMinor).toBe(0);
    await expect(c.disputes.open({ milestoneId, userId: "usr_asha", reason: "x" })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("S15 genuine partial damage: 70/30 split, payout + refund through PayPal, ledger balanced", async () => {
    const { jobId, milestoneId } = await inChallengeWindow();
    const dispute = await c.disputes.open({ milestoneId, userId: "usr_ravi", reason: "Cartons damaged" });
    await c.disputes.addEvidence({ disputeId: dispute.id, userId: "usr_ravi", text: "6 of 20 cartons arrived crushed and the tea inside was spilled", photo: await makeSamplePhoto({ seed: "crushed", caption: "crushed cartons" }) });
    await c.disputes.addEvidence({ disputeId: dispute.id, userId: "usr_asha", text: "They were sealed and intact at pickup" });
    clock.advance(46_000);
    expect(await c.disputes.processDueWindows()).toBeGreaterThanOrEqual(1);

    const view = (await c.disputes.get(dispute.id))!;
    expect(view.dispute.status).toBe("AI_PROPOSED");
    const p = view.proposal!.proposalJson as DisputeProposal;
    expect(p.proposal).toMatchObject({ releaseToWorkerMinor: 2800, refundToPayerMinor: 1200 }); // 40.00 split 70/30
    expect(p.liability).toMatchObject({ faultClass: "WORKER_PARTIAL", bearer: "worker", mandateComplianceReportId: view.report!.id });
    expect(view.report?.summary).toMatch(/Direct job/);

    const before = await trust("usr_asha");
    await c.disputes.respond({ disputeId: dispute.id, userId: "usr_asha", accept: true });
    await c.disputes.respond({ disputeId: dispute.id, userId: "usr_ravi", accept: true });

    const d = (await c.jobs.detail(jobId))!;
    expect(d.milestones[0].status).toBe("RESOLVED");
    expect(d.milestones[1].status).toBe("ACTIVE");
    expect(d.job.status).toBe("IN_PROGRESS");
    expect(d.money.releasedMinor).toBe(2800);
    // Fee share for milestone 1 is 80; 70% (56) is earned, 24 goes back with the 1200 refund.
    expect(d.money.refundedMinor).toBe(1224);
    expect(await c.ledger.balance(escrowCode(jobId))).toBe(10200 - 2800 - 56 - 1224);
    expect(await c.ledger.checkInvariants()).toEqual([]);
    expect(await trust("usr_asha")).toBe(before - 4);
    const chain = await c.attestations.chain(jobId);
    expect(chain.at(-1)).toMatchObject({ type: "settlement", payload: { event: "dispute_settled", faultClass: "WORKER_PARTIAL" } });
    expect(await c.attestations.verify(jobId)).toMatchObject({ ok: true });
  });

  it("S14 claim without evidence: PAYER_UNSUPPORTED_CLAIM, worker paid in full, payer trust drops", async () => {
    const { jobId, milestoneId } = await inChallengeWindow();
    const dispute = await c.disputes.open({ milestoneId, userId: "usr_ravi", reason: "Not happy" });
    const p = (await c.disputes.proposeNow({ disputeId: dispute.id, userId: "usr_ravi" }))!.proposalJson as DisputeProposal;
    expect(p.liability.faultClass).toBe("PAYER_UNSUPPORTED_CLAIM");
    expect(p.liability.basis[0]).toContain("#settlementConditions[milestoneSeq=");
    expect(p.liability.basis[0].startsWith("mandate:payment:")).toBe(true);
    expect(p.proposal).toMatchObject({ releaseToWorkerMinor: 4000, refundToPayerMinor: 0 });
    const payerBefore = await trust("usr_ravi");
    await c.disputes.respond({ disputeId: dispute.id, userId: "usr_ravi", accept: true });
    await c.disputes.respond({ disputeId: dispute.id, userId: "usr_asha", accept: true });
    expect((await c.jobs.detail(jobId))!.money.releasedMinor).toBe(4000);
    expect(await trust("usr_ravi")).toBe(payerBefore - 8);
  });

  it("a rejected proposal escalates; the admin's split is executed and attested", async () => {
    const { jobId, milestoneId } = await inChallengeWindow();
    const dispute = await c.disputes.open({ milestoneId, userId: "usr_ravi", reason: "Late" });
    await c.disputes.proposeNow({ disputeId: dispute.id, userId: "usr_asha" });
    await c.disputes.respond({ disputeId: dispute.id, userId: "usr_ravi", accept: false });
    expect((await c.disputes.get(dispute.id))!.dispute.status).toBe("ESCALATED");
    await c.disputes.adminResolve({ disputeId: dispute.id, adminId: "usr_meera", releaseToWorkerMinor: 2000, faultClass: "SPEC_AMBIGUITY", note: "Due time was unclear" });
    const d = (await c.jobs.detail(jobId))!;
    expect(d.money.releasedMinor).toBe(2000);
    expect((await c.disputes.get(dispute.id))!.dispute.status).toBe("EXECUTED");
    expect((await c.attestations.chain(jobId)).some((a) => a.type === "dispute" && a.payload.event === "admin_resolved")).toBe(true);
    expect(await c.ledger.checkInvariants()).toEqual([]);
  });

  it("S26 an out-of-mandate job (admin-forced fixture) makes the payer whole and suspends the agent", async () => {
    const r = await c.agentJobs.create({ clientId: PROCUREBOT_CLIENT_ID, mandateId, description: "Deliver 5 boxes from Rajwada to Vijay Nagar", budgetMinor: 4000, requestNonce: "req_s26_fixture" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const order = await c.funding.start({ jobId: r.job.id, payerId: "usr_ravi" });
    mock.approveOrder(order.orderId);
    await c.funding.capture({ jobId: r.job.id, payerId: "usr_ravi", orderId: order.orderId });
    await c.deliverMockWebhooks();
    await c.jobs.accept({ jobId: r.job.id, workerId: "usr_asha" });
    await c.mandates.revoke({ mandateId, actorUserId: "usr_ravi", actorRole: "payer", reason: "test" });

    // Admin-forced fixture (spec Appendix B S26): the job's mandate is back-dated to after the revocation
    // and its first milestone is put in its challenge window, as if an out-of-scope action had slipped through.
    await c.dbHandle.db.execute(
      sql`update mandates set created_at = (select revoked_at from mandates where id = ${mandateId}) + interval '1 hour' where type = 'job' and subject_id = ${r.job.id}`,
    );
    const m1 = (await c.jobs.detail(r.job.id))!.milestones[0];
    await c.dbHandle.db.update(milestones).set({ status: "CHALLENGE_WINDOW" }).where(eq(milestones.id, m1.id));

    const dispute = await c.disputes.open({ milestoneId: m1.id, userId: "usr_ravi", reason: "I never authorized this" });
    const p = (await c.disputes.proposeNow({ disputeId: dispute.id, userId: "usr_ravi" }))!.proposalJson as DisputeProposal;
    expect(p.liability).toMatchObject({ faultClass: "AGENT_SCOPE_VIOLATION", bearer: "agent_principal" });
    expect(p.liability.basis).toContain("compliance:job_created_after_revocation");
    expect(p.proposal.releaseToWorkerMinor).toBe(0);
    await c.disputes.respond({ disputeId: dispute.id, userId: "usr_ravi", accept: true });
    await c.disputes.respond({ disputeId: dispute.id, userId: "usr_asha", accept: true });
    const [client] = await c.dbHandle.db.select().from(apiClients).where(eq(apiClients.id, PROCUREBOT_CLIENT_ID));
    expect(client.status).toBe("suspended");
    expect((await c.jobs.detail(r.job.id))!.money.refundedMinor).toBeGreaterThan(0);
    expect(await c.ledger.checkInvariants()).toEqual([]);
  });
});

describe("arbiter invariants are enforced in code", () => {
  const input = (over: Partial<ArbiterInput["report"]> = {}): ArbiterInput => ({
    disputeId: "dsp_1",
    disputedAmountMinor: 6000,
    milestone: { seq: 1, title: "Drop-off", criteria: [] },
    verification: null,
    decision: null,
    statements: [],
    images: [],
    report: { id: "cr_1", jobId: "j", agentInitiated: false, intentMandateId: null, checks: [], violations: [], agentScopeViolation: false, summary: "", clauses: [], ...over },
    openedBy: "payer",
    reason: "x",
  });

  it("corrects amounts that do not add up and sends the case to a person", () => {
    const bad = structuredClone(sampleDisputeProposal);
    bad.proposal.releaseToWorkerMinor = 5000;
    bad.proposal.refundToPayerMinor = 5000;
    const p = enforceProposal(bad, input(), false);
    expect(p.proposal.releaseToWorkerMinor + p.proposal.refundToPayerMinor).toBe(6000);
    expect(p.requiresHuman).toBe(true);
  });

  it("the compliance report overrides the model's fault class", () => {
    const p = enforceProposal(sampleDisputeProposal, input({ agentScopeViolation: true, violations: ["job_created_after_revocation"] }), false);
    expect(p.liability.faultClass).toBe("AGENT_SCOPE_VIOLATION");
    expect(p.proposal).toMatchObject({ releaseToWorkerMinor: 0, refundToPayerMinor: 6000 });
  });

  it("a model claiming a mandate violation the report does not show is overruled", () => {
    const claim = structuredClone(sampleDisputeProposal);
    claim.liability.faultClass = "AGENT_SCOPE_VIOLATION";
    const p = enforceProposal(claim, input(), false);
    expect(p.liability.faultClass).not.toBe("AGENT_SCOPE_VIOLATION");
    expect(p.requiresHuman).toBe(true);
  });

  it("injection in statements forces human review", () => {
    expect(enforceProposal(sampleDisputeProposal, input(), true).requiresHuman).toBe(true);
  });
});

describe("liability findings cite the mandate", () => {
  const report: ComplianceReport = {
    id: "cr_1",
    jobId: "job_1",
    agentInitiated: true,
    intentMandateId: "mnd_i",
    checks: [],
    violations: [],
    agentScopeViolation: false,
    summary: "",
    clauses: [
      { ref: "mandate:payment:mnd_p#settlementConditions[milestoneSeq=1]", text: "pay" },
      { ref: "mandate:job:mnd_j#criteriaHash", text: "job" },
      { ref: "mandate:intent:mnd_i#scope", text: "scope" },
    ],
  };

  it("adds the governing clause when the model cites none, keeping criteria and evidence", () => {
    expect(citeMandateClauses(["criterion:c1", "evidence:e1"], "WORKER_PARTIAL", report)).toEqual(["mandate:payment:mnd_p#settlementConditions[milestoneSeq=1]", "criterion:c1", "evidence:e1"]);
  });

  it("cites the scope clause for an agent scope violation", () => {
    expect(citeMandateClauses([], "AGENT_SCOPE_VIOLATION", report)).toEqual(["mandate:intent:mnd_i#scope"]);
  });

  it("drops a clause the model made up and keeps real ones", () => {
    expect(citeMandateClauses(["mandate:intent:fake#scope", "mandate:job:mnd_j#criteriaHash", "criterion:c1"], "WORKER_PARTIAL", report)).toEqual(["mandate:job:mnd_j#criteriaHash", "criterion:c1"]);
    expect(citeMandateClauses(["mandate:intent:fake#scope"], "WORKER_PARTIAL", report)).toEqual(["mandate:payment:mnd_p#settlementConditions[milestoneSeq=1]"]);
  });
});
