import type { DisputeProposal, IntentMandatePayload, JobSpec } from "@/core/contracts";

export const sampleJobSpec: JobSpec = {
  title: "Same-day delivery of 20 cartons to Vijay Nagar",
  category: "delivery",
  summary: "Pick up 20 cartons from Ravi Traders and deliver to the retail shop by 6 pm.",
  currency: "USD",
  totalAmountMinor: 10000,
  location: { lat: 22.7533, lng: 75.8937, radiusM: 150, label: "Vijay Nagar, Indore" },
  milestones: [
    {
      seq: 1,
      title: "Pickup",
      description: "Collect 20 sealed cartons from the warehouse.",
      amountMinor: 4000,
      dueAt: "2026-10-20T10:30:00Z",
      acceptanceCriteria: [
        { id: "c1", text: "Photo of 20 sealed cartons at the pickup point", evidenceType: "photo", check: "ai_visual" },
        { id: "c2", text: "Photo GPS within 150 m of the warehouse", evidenceType: "geo", check: "deterministic", params: { maxDistanceM: 150 } },
      ],
    },
    {
      seq: 2,
      title: "Drop-off",
      description: "Deliver all cartons to the shop and get recipient confirmation.",
      amountMinor: 6000,
      dueAt: "2026-10-20T12:30:00Z",
      acceptanceCriteria: [
        { id: "c1", text: "Photo of cartons at the shop entrance", evidenceType: "photo", check: "ai_visual" },
        { id: "c2", text: "Drop-off GPS within 150 m of the shop", evidenceType: "geo", check: "deterministic", params: { maxDistanceM: 150 } },
        { id: "c3", text: "Recipient name typed as confirmation", evidenceType: "text", check: "ai_text" },
      ],
    },
  ],
  clarifyingQuestions: [],
  riskNotes: [],
  confidence: 0.9,
};

export const sampleIntentMandate: IntentMandatePayload = {
  type: "intent",
  version: 1,
  id: "mnd_01J9ZQMAND1",
  createdAt: "2026-10-20T09:00:00Z",
  notBefore: "2026-10-20T09:00:00Z",
  notAfter: "2026-10-21T12:30:00Z",
  issuer: { userId: "usr_ravi", keyId: "key_ravi_1" },
  agent: { clientId: "cli_procurebot", name: "ProcureBot" },
  humanPresence: "not_present",
  scope: {
    categories: ["delivery"],
    currency: "USD",
    maxPerJobMinor: 15000,
    maxTotalMinor: 40000,
    maxJobsPerDay: 5,
    geoFence: { lat: 22.7196, lng: 75.8577, radiusKm: 25 },
    counterparty: { minTrustScore: 40, requirePayPalEmail: true },
    prohibitedKeywords: ["gift card", "crypto", "cash"],
  },
  conditions: {
    requireVerificationBeforeRelease: true,
    stepUpAboveMinor: 10000,
    maxAutoReleaseMinor: 5000,
    maxChallengeWindowSeconds: 86400,
  },
  nonce: "n_8f31c2d9",
};

export const sampleDisputeProposal: DisputeProposal = {
  disputeId: "dsp_1",
  findings: {
    agreedFacts: ["Cartons arrived at the shop"],
    contestedFacts: ["Whether 6 cartons were damaged in transit"],
    evidenceAssessment: [{ evidenceId: "ev_1", weight: 0.8, note: "Photo shows crushed cartons" }],
  },
  proposal: {
    releaseToWorkerMinor: 4200,
    refundToPayerMinor: 1800,
    rationale: "Delivery happened; 30 percent of the goods arrived damaged.",
    criteriaOutcome: [
      { criterionId: "c1", met: true, note: "Delivered" },
      { criterionId: "c3", met: false, note: "Damage noted by recipient" },
    ],
  },
  liability: {
    faultClass: "WORKER_PARTIAL",
    bearer: "worker",
    basis: ["criterion:c3", "evidence:ev_1"],
    mandateComplianceReportId: "cr_1",
  },
  confidence: 0.82,
  alternatives: [],
  precedentsUsed: [],
  requiresHuman: false,
  reasonsIfHuman: [],
};
