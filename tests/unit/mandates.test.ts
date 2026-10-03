import { exportJWK, generateKeyPair } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signCanonical } from "@/core/mandates/jws";
import type { IntentDraftInput } from "@/core/services/mandates";
import { testWorld, type TestWorld } from "../helpers";

let w: TestWorld;
beforeAll(async () => {
  w = await testWorld();
});
afterAll(() => w.h.close());

const baseDraft = (keyId: string): IntentDraftInput => ({
  issuerUserId: "usr_ravi",
  keyId,
  agentClientId: "cli_testbot",
  categories: ["delivery"],
  maxPerJobMinor: 15000,
  maxTotalMinor: 40000,
  maxJobsPerDay: 5,
  ttlSeconds: 86400,
  geoFence: { lat: 22.7196, lng: 75.8577, radiusKm: 25, label: "Indore" },
  minTrustScore: 40,
  requirePayPalEmail: true,
  prohibitedKeywords: ["gift card", "crypto", "cash"],
  stepUpAboveMinor: 10000,
  maxAutoReleaseMinor: 5000,
  maxChallengeWindowSeconds: 86400,
});

async function browserKey(ownerId = "usr_ravi") {
  // Simulates the browser: the private key never leaves the client; only the public JWK is registered.
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const keyId = await w.keys.registerPublicKey("user", ownerId, await exportJWK(publicKey));
  return { keyId, privateKey };
}

describe("Intent Mandates", () => {
  it("renders the Appendix E plain-language preview", async () => {
    const k = await browserKey();
    const { plainLanguage } = await w.mandates.draftIntent(baseDraft(k.keyId));
    expect(plainLanguage).toContain("Allow TestBot to hire delivery services within 25 km of Indore");
    expect(plainLanguage).toContain("up to $150.00 per job and $400.00 in total, at most 5 jobs a day");
    expect(plainLanguage).toContain("I must approve any job above $100.00");
  });

  it("creates an ACTIVE mandate from a browser signature and rejects a replay", async () => {
    const k = await browserKey();
    const { payload } = await w.mandates.draftIntent(baseDraft(k.keyId));
    const jws = await signCanonical(payload, k.privateKey, k.keyId);
    const view = await w.mandates.createIntent({ userId: "usr_ravi", payload, jws });
    expect(view.status).toBe("active");
    expect(view.remainingMinor).toBe(40000);
    await expect(w.mandates.createIntent({ userId: "usr_ravi", payload, jws })).rejects.toMatchObject({ code: "MANDATE_REPLAY" });
  });

  it("rejects a signature over different terms (MANDATE_SIGNATURE_INVALID)", async () => {
    const k = await browserKey();
    const { payload } = await w.mandates.draftIntent(baseDraft(k.keyId));
    const jws = await signCanonical(payload, k.privateKey, k.keyId);
    const inflated = { ...payload, scope: { ...payload.scope, maxPerJobMinor: 999999, maxTotalMinor: 999999 } };
    await expect(w.mandates.createIntent({ userId: "usr_ravi", payload: inflated, jws })).rejects.toMatchObject({
      code: "MANDATE_SIGNATURE_INVALID",
    });
  });

  it("rejects signing with someone else's key", async () => {
    const asha = await browserKey("usr_asha");
    const { payload } = await w.mandates.draftIntent(baseDraft(asha.keyId));
    const jws = await signCanonical(payload, asha.privateKey, asha.keyId);
    await expect(w.mandates.createIntent({ userId: "usr_ravi", payload, jws })).rejects.toMatchObject({
      code: "MANDATE_SIGNATURE_INVALID",
    });
  });

  it("managed-key mode signs server-side with the encrypted demo key", async () => {
    const keyId = await w.keys.ensureManagedKey("user", "usr_ravi");
    expect(await w.keys.ensureManagedKey("user", "usr_ravi")).toBe(keyId);
    const { payload } = await w.mandates.draftIntent(baseDraft(keyId));
    const jws = await w.mandates.signWithManagedKey("usr_ravi", payload);
    expect((await w.mandates.createIntent({ userId: "usr_ravi", payload, jws })).status).toBe("active");
  });

  it("expires by the clock and revocation is immediate and audited", async () => {
    const k = await browserKey();
    const { payload } = await w.mandates.draftIntent({ ...baseDraft(k.keyId), ttlSeconds: 60 });
    const view = await w.mandates.createIntent({ userId: "usr_ravi", payload, jws: await signCanonical(payload, k.privateKey, k.keyId) });
    const revoked = await w.mandates.revoke({ mandateId: view.id, actorUserId: "usr_ravi", actorRole: "payer", reason: "test" });
    expect(revoked.status).toBe("revoked");
    await expect(
      w.mandates.revoke({ mandateId: view.id, actorUserId: "usr_asha", actorRole: "worker", reason: "x" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const k2 = await browserKey();
    const d2 = await w.mandates.draftIntent({ ...baseDraft(k2.keyId), ttlSeconds: 60 });
    const v2 = await w.mandates.createIntent({ userId: "usr_ravi", payload: d2.payload, jws: await signCanonical(d2.payload, k2.privateKey, k2.keyId) });
    w.clock.advance(61_000);
    expect((await w.mandates.get(v2.id))!.status).toBe("expired");
    expect((await w.audit.verifyChain()).ok).toBe(true);
  });
});

describe("spend counters", () => {
  async function activeMandate(overrides: Partial<IntentDraftInput> = {}) {
    const k = await browserKey();
    const { payload } = await w.mandates.draftIntent({ ...baseDraft(k.keyId), ...overrides });
    return w.mandates.createIntent({ userId: "usr_ravi", payload, jws: await signCanonical(payload, k.privateKey, k.keyId) });
  }

  it("enforces per-job, total and per-day caps with reason codes", async () => {
    const m = await activeMandate({ maxJobsPerDay: 2 });
    const reserve = (amountMinor: number) => w.db.transaction((tx) => w.mandates.reserveSpend(tx, { mandateId: m.id, amountMinor, countsAsJob: true }));
    expect(await reserve(15001)).toMatchObject({ ok: false, codes: ["MANDATE_CAP_EXCEEDED"] });
    expect(await reserve(15000)).toEqual({ ok: true });
    expect(await reserve(15000)).toEqual({ ok: true });
    expect(await reserve(100)).toMatchObject({ ok: false, codes: ["MANDATE_RATE_EXCEEDED"] });
    expect((await w.mandates.get(m.id))!.remainingMinor).toBe(10000);
  });

  it("50 parallel requests never exceed the total cap", async () => {
    const m = await activeMandate({ maxJobsPerDay: 1000, maxTotalMinor: 40000, maxPerJobMinor: 15000 });
    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        w.db.transaction((tx) => w.mandates.reserveSpend(tx, { mandateId: m.id, amountMinor: 3000, countsAsJob: true })),
      ),
    );
    const allowed = results.filter((r) => r.ok).length;
    expect(allowed).toBe(13); // floor(40000 / 3000)
    const view = (await w.mandates.get(m.id))!;
    expect(view.spentMinor).toBe(39000);
    expect(view.spentMinor).toBeLessThanOrEqual(40000);
  });
});

describe("attestation service", () => {
  it("persists a signed chain per job that verifies, with the platform key", async () => {
    for (const type of ["mandate", "evidence", "decision"] as const) {
      await w.attestations.append({ jobId: "job_chain", type, subjectId: "m_1", payload: { type } });
    }
    expect(await w.attestations.verify("job_chain")).toEqual({ ok: true, checked: 3 });
    const chain = await w.attestations.chain("job_chain");
    expect(chain.map((a) => a.seq)).toEqual([0, 1, 2]);
    expect(chain[1].prevHash).toBe(chain[0].hash);
  });
});
