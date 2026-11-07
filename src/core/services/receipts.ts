// Builds the public receipt bundle for a funded job (spec §7.6): mandates, the full proof chain, the
// public keys needed to verify them, masked PayPal references and a ledger summary. No personal data:
// users appear only as opaque ids, and locations only as labels.
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import type { Db } from "@/core/db/client";
import { fundingOrders, mandates, payouts, refunds } from "@/core/db/schema";
import type { JobSpec, MandateEnvelope, PaymentMandatePayload } from "@/core/contracts";
import { maskId, RECEIPT_FORMAT, type ReceiptBundle } from "@/core/verifier/receipt";
import type { ClockPort } from "@/core/ports/clock";
import type { LedgerService } from "./ledger";
import type { AttestationService } from "./attestations";
import type { JobService } from "./jobs";
import type { KeyService } from "./keys";

const env = (m: typeof mandates.$inferSelect): MandateEnvelope =>
  ({ payload: m.payloadJson, payloadHash: m.payloadHash, signatures: m.signaturesJson }) as MandateEnvelope;

export class ReceiptService {
  constructor(
    private readonly db: Db,
    private readonly jobs: JobService,
    private readonly attestations: AttestationService,
    private readonly keys: KeyService,
    private readonly clock: ClockPort,
    private readonly ledger: LedgerService,
  ) {}

  async build(jobId: string): Promise<ReceiptBundle | null> {
    const detail = await this.jobs.detail(jobId);
    if (!detail) return null;
    const rows = await this.db.select().from(mandates).where(and(eq(mandates.subjectId, jobId), ne(mandates.status, "revoked"))).orderBy(desc(mandates.createdAt));
    const jobMandate = rows.find((m) => m.type === "job");
    const payMandate = rows.find((m) => m.type === "payment");
    if (!jobMandate || !payMandate) return null; // receipts exist once a job is funded
    const [intent] = jobMandate.parentId ? await this.db.select().from(mandates).where(eq(mandates.id, jobMandate.parentId)) : [];

    const chain = await this.attestations.chain(jobId);
    const keyIds = new Set<string>([
      ...chain.map((a) => a.signer.keyId),
      ...[jobMandate, payMandate, intent].filter(Boolean).flatMap((m) => (m!.signaturesJson as { keyId: string }[]).map((s) => s.keyId)),
    ]);
    const allKeys = await this.keys.listPublic();
    const [funding] = await this.db.select().from(fundingOrders).where(and(eq(fundingOrders.jobId, jobId), eq(fundingOrders.status, "CONFIRMED")));
    const releaseIds = detail.releases.map((r) => r.id);
    const payoutRows = releaseIds.length ? await this.db.select().from(payouts).where(inArray(payouts.releaseId, releaseIds)) : [];
    const refundRows = await this.db.select().from(refunds).where(eq(refunds.jobId, jobId));
    const spec = detail.job.specJson as JobSpec;

    return {
      format: RECEIPT_FORMAT,
      version: 1,
      publicId: jobId,
      issuedAt: this.clock.now().toISOString(),
      job: {
        title: detail.job.title,
        category: detail.job.category,
        status: detail.job.status,
        currency: "USD",
        totalMinor: detail.job.totalMinor,
        feeMinor: detail.job.feeMinor,
        agentInitiated: detail.job.createdBy.startsWith("api_client:"),
        locationLabel: spec.location?.label ?? null,
      },
      mandates: { intent: intent ? env(intent) : null, job: env(jobMandate), payment: env(payMandate) },
      fees: {
        serviceFeeMinor: detail.job.feeMinor,
        processingFeeMinor: (payMandate?.payloadJson as PaymentMandatePayload | undefined)?.funding.processingFeeMinor ?? 0,
        paypalChargedMinor: await this.ledger.paypalFeesFor([...(funding ? [funding.id] : []), ...payoutRows.map((p) => p.id)]),
      },
      attestations: chain,
      keys: allKeys.filter((k) => keyIds.has(k.keyId)),
      paypal: {
        orderId: maskId(funding?.paypalOrderId),
        captureId: maskId(funding?.paypalCaptureId),
        payoutItemIds: payoutRows.map((p) => maskId(p.paypalItemId)).filter((x): x is string => Boolean(x)),
        refundIds: refundRows.map((r) => maskId(r.paypalRefundId)).filter((x): x is string => Boolean(x)),
      },
      ledger: detail.money,
    };
  }

  /** Platform key ids SettleAI publishes, for pinning by verifiers. */
  async platformKeyIds(): Promise<string[]> {
    return (await this.keys.listPublic()).filter((k) => k.ownerType === "platform").map((k) => k.keyId);
  }
}
