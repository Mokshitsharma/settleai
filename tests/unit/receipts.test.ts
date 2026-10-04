// Spec §7.6 and Appendix B S25: receipts verify offline; any tamper fails and points to the broken link.
import { exportJWK, generateKeyPair } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MockPayPalAdapter } from "@/core/adapters/paypal/mock";
import { makeSamplePhoto } from "@/core/checks/sample-photos";
import { loadConfig } from "@/core/config";
import { createContainer, type Container } from "@/core/container";
import { openTestDb } from "@/core/db/client";
import { seed } from "@/core/db/seed";
import { PROCUREBOT_CLIENT_ID, seedDemo } from "@/core/db/seed-demo";
import { hashCanonical } from "@/core/mandates/canonical";
import { attestationHash, sealAttestation } from "@/core/mandates/envelope";
import { keyIdFor } from "@/core/mandates/jws";
import { FixedClock } from "@/core/ports/clock";
import { verifyReceipt, type ReceiptBundle } from "@/core/verifier/receipt";
import { sampleJobSpec } from "../fixtures/contracts";
import { T0 } from "../helpers";

let c: Container;
let mock: MockPayPalAdapter;
let clock: FixedClock;
let direct: ReceiptBundle;
let agent: ReceiptBundle;
let platformKeys: string[];

async function runJob(jobId: string, location: { lat: number; lng: number }) {
  const order = await c.funding.start({ jobId, payerId: "usr_ravi" });
  mock.approveOrder(order.orderId);
  await c.funding.capture({ jobId, payerId: "usr_ravi", orderId: order.orderId });
  await c.deliverMockWebhooks();
  await c.jobs.accept({ jobId, workerId: "usr_asha" });
  clock.advance(10 * 60_000);
  const m1 = (await c.jobs.detail(jobId))!.milestones[0];
  const bytes = await makeSamplePhoto({ seed: `receipt-${jobId}`, caption: "x", takenAt: new Date(clock.now().getTime() - 60_000), location });
  await c.proofs.addPhoto({ milestoneId: m1.id, workerId: "usr_asha", bytes, declaredMime: "image/jpeg" });
  await c.proofs.submit({ milestoneId: m1.id, workerId: "usr_asha" });
  await c.verification.run(m1.id);
  clock.advance(60_000);
  await c.releases.processDueWindows();
}

beforeAll(async () => {
  const dbHandle = await openTestDb();
  await seed(dbHandle.db);
  mock = new MockPayPalAdapter();
  clock = new FixedClock(T0);
  c = await createContainer(loadConfig({ CHALLENGE_WINDOW_SECONDS: "15" }), { dbHandle, clock, payments: mock });
  const [mandateId] = (await seedDemo(c)).mandateIds;

  const job = await c.jobs.createFromSpec({ payerId: "usr_ravi", spec: sampleJobSpec, createdBy: "user:usr_ravi" });
  await runJob(job.id, { lat: 22.7533, lng: 75.8937 });
  direct = (await c.receipts.build(job.id))!;

  const r = await c.agentJobs.create({ clientId: PROCUREBOT_CLIENT_ID, mandateId, description: "Deliver 5 boxes from Rajwada to Vijay Nagar", budgetMinor: 4000, requestNonce: "req_receipt_agent" });
  if (!r.ok) throw new Error("agent job denied");
  await runJob(r.job.id, { lat: 22.7186, lng: 75.8553 });
  agent = (await c.receipts.build(r.job.id))!;
  platformKeys = await c.receipts.platformKeyIds();
});
afterAll(() => c.dbHandle.close());

const clone = (b: ReceiptBundle) => JSON.parse(JSON.stringify(b)) as ReceiptBundle;

describe("receipt bundle", () => {
  it("contains no exact coordinates or emails", () => {
    const text = JSON.stringify(direct);
    expect(text).not.toMatch(/@/);
    expect(text).not.toContain("75.8937");
    expect(direct.paypal.captureId).toMatch(/…/);
  });

  it("verifies a direct job and an agent job, with the platform key pinned", async () => {
    for (const b of [direct, agent]) {
      const r = await verifyReceipt(b, { trustedPlatformKeyIds: platformKeys });
      expect(r.checks.filter((x) => !x.ok)).toEqual([]);
      expect(r.ok).toBe(true);
    }
    expect(agent.mandates.intent).not.toBeNull();
    const r = await verifyReceipt(agent);
    expect(r.checks.find((x) => x.id === "lineage")?.detail).toMatch(/intent mandate link correctly/);
  });

  it("warns, but still checks consistency, when the platform key is not pinned", async () => {
    const r = await verifyReceipt(direct);
    expect(r.ok).toBe(true);
    expect(r.warnings[0]).toMatch(/not pinned/);
  });
});

describe("S25 tamper detection", () => {
  it("changing ANY single attestation field fails and points at that attestation", async () => {
    let tested = 0;
    for (const a of direct.attestations) {
      for (const field of ["payload", "createdAt", "subjectId", "type"] as const) {
        const t = clone(direct);
        const target = t.attestations[a.seq];
        if (field === "payload") {
          const key = Object.keys(target.payload)[0];
          const v = target.payload[key];
          target.payload[key] = typeof v === "number" ? v + 1 : `${String(v)}x`;
        } else if (field === "createdAt") {
          target.createdAt = new Date(Date.parse(target.createdAt) + 1000).toISOString();
        } else if (field === "type") {
          target.type = target.type === "settlement" ? "decision" : "settlement";
        } else {
          target.subjectId = `${target.subjectId}x`;
        }
        const r = await verifyReceipt(t, { trustedPlatformKeyIds: platformKeys });
        expect(r.ok, `${field} of seq ${a.seq}`).toBe(false);
        const failed = r.checks.find((x) => !x.ok)!;
        expect(failed.pointer ?? "").toContain(`attestations[${a.seq}]`);
        tested++;
      }
    }
    expect(tested).toBeGreaterThan(30);
  });

  it("one changed digit in the payout amount fails, even if the attacker recomputes the hashes", async () => {
    const t = clone(direct);
    const s = t.attestations.find((a) => a.type === "settlement")!;
    s.payload.amountMinor = 9000;
    s.payloadHash = hashCanonical(s.payload);
    const { hash: _h, signature: _s, ...unsigned } = s;
    s.hash = attestationHash(unsigned);
    const r = await verifyReceipt(t, { trustedPlatformKeyIds: platformKeys });
    expect(r.ok).toBe(false);
    expect(r.checks.find((x) => x.id === "chain")).toMatchObject({ ok: false, pointer: expect.stringContaining(`attestations[${s.seq}]`) });
  });

  it("an attacker who re-signs the whole chain with their own key is caught by key pinning", async () => {
    const t = clone(direct);
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const jwk = await exportJWK(publicKey);
    const kid = await keyIdFor(jwk);
    t.keys.push({ keyId: kid, publicJwk: jwk, ownerType: "platform", ownerId: "platform", status: "active", createdAt: "2020-01-01T00:00:00Z" });
    let prev = "GENESIS";
    for (const [i, a] of t.attestations.entries()) {
      if (a.type === "settlement") a.payload.amountMinor = 9999;
      a.payloadHash = hashCanonical(a.payload);
      const forged = await sealAttestation({ ...a, prevHash: prev as "GENESIS", signer: { role: "platform", keyId: kid } }, privateKey);
      t.attestations[i] = forged;
      prev = forged.hash;
    }
    const pinned = await verifyReceipt(t, { trustedPlatformKeyIds: platformKeys });
    expect(pinned.ok).toBe(false);
    expect(pinned.checks.find((x) => x.id === "keys")?.detail).toMatch(/not one SettleAI published/);
  });

  it("swapping in a different (validly signed) payment mandate is caught by anchoring", async () => {
    const t = clone(direct);
    const other = clone(agent);
    t.mandates.payment = other.mandates.payment;
    t.keys.push(...other.keys);
    const r = await verifyReceipt(t, { trustedPlatformKeyIds: platformKeys });
    expect(r.ok).toBe(false);
    expect(r.checks.filter((x) => !x.ok).map((x) => x.id)).toEqual(expect.arrayContaining(["lineage"]));
  });

  it("deleting an attestation breaks the chain", async () => {
    const t = clone(direct);
    t.attestations.splice(2, 1);
    expect((await verifyReceipt(t)).ok).toBe(false);
  });

  it("garbage is rejected as not a receipt", async () => {
    expect((await verifyReceipt({ hello: "world" })).checks[0]).toMatchObject({ id: "format", ok: false });
  });
});
