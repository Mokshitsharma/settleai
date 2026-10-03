// Proof Chain persistence (spec §7.6). Every job has a hash-linked chain of signed attestations.
import { asc, desc, eq, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "@/core/db/client";
import { attestations } from "@/core/db/schema";
import type { Attestation, AttestationType, SignerRole } from "@/core/contracts";
import { newId } from "@/core/ids";
import { hashCanonical } from "@/core/mandates/canonical";
import { CHAIN_GENESIS, sealAttestation, verifyAttestationChain, type ChainCheck } from "@/core/mandates/envelope";
import type { ClockPort } from "@/core/ports/clock";
import type { KeyService, Signer } from "./keys";

export interface AppendAttestation {
  jobId: string;
  type: AttestationType;
  subjectId: string;
  payload: Record<string, unknown>;
  signerRole?: SignerRole; // default platform
  signer?: Signer; // default platform key
}

function rowToAttestation(r: typeof attestations.$inferSelect): Attestation {
  return {
    id: r.id,
    jobId: r.jobId,
    seq: r.seq,
    type: r.type as AttestationType,
    subjectId: r.subjectId,
    payloadHash: r.payloadHash,
    payload: r.payloadJson as Record<string, unknown>,
    signer: { role: r.signerRole as SignerRole, keyId: r.keyId },
    prevHash: r.prevHash as Attestation["prevHash"],
    hash: r.hash,
    signature: r.signature,
    createdAt: r.createdAt.toISOString(),
  };
}

export class AttestationService {
  constructor(
    private readonly db: Db,
    private readonly keys: KeyService,
    private readonly clock: ClockPort,
  ) {}

  async append(input: AppendAttestation, tx?: DbOrTx): Promise<Attestation> {
    const signer = input.signer ?? (await this.keys.platformSigner());
    const run = async (t: DbOrTx) => {
      // Serialize appends per job so seq and prevHash never fork.
      await t.execute(sql`select pg_advisory_xact_lock(hashtext(${"att:" + input.jobId}))`);
      const [last] = await t
        .select()
        .from(attestations)
        .where(eq(attestations.jobId, input.jobId))
        .orderBy(desc(attestations.seq))
        .limit(1);
      const sealed = await sealAttestation(
        {
          id: newId("att"),
          jobId: input.jobId,
          seq: last ? last.seq + 1 : 0,
          type: input.type,
          subjectId: input.subjectId,
          payloadHash: hashCanonical(input.payload),
          payload: input.payload,
          signer: { role: input.signerRole ?? "platform", keyId: signer.keyId },
          prevHash: (last?.hash ?? CHAIN_GENESIS) as Attestation["prevHash"],
          // Millisecond precision only, so the stored timestamp round-trips exactly.
          createdAt: new Date(Math.floor(this.clock.now().getTime())).toISOString(),
        },
        signer.privateKey,
      );
      await t.insert(attestations).values({
        id: sealed.id,
        jobId: sealed.jobId,
        seq: sealed.seq,
        type: sealed.type,
        subjectId: sealed.subjectId,
        payloadJson: sealed.payload,
        payloadHash: sealed.payloadHash,
        signerRole: sealed.signer.role,
        keyId: sealed.signer.keyId,
        prevHash: sealed.prevHash,
        hash: sealed.hash,
        signature: sealed.signature,
        createdAt: new Date(sealed.createdAt),
      });
      return sealed;
    };
    return tx ? run(tx) : this.db.transaction(run);
  }

  async chain(jobId: string, t: DbOrTx = this.db): Promise<Attestation[]> {
    const rows = await t.select().from(attestations).where(eq(attestations.jobId, jobId)).orderBy(asc(attestations.seq));
    return rows.map(rowToAttestation);
  }

  async verify(jobId: string): Promise<ChainCheck> {
    return verifyAttestationChain(await this.chain(jobId), (kid) => this.keys.resolve(kid));
  }
}
