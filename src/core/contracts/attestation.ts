import { z } from "zod";
import { Hex64, IsoDateTime } from "./common";
import { SignerRole } from "./mandates";

export const AttestationType = z.enum([
  "mandate",
  "evidence",
  "verification",
  "decision",
  "release",
  "settlement",
  "dispute",
  "revocation",
  "denial",
]);
export type AttestationType = z.infer<typeof AttestationType>;

/** hash = sha256(canonical(attestation without hash and signature)); signature is a JWS over that hash. */
export const Attestation = z.object({
  id: z.string(),
  jobId: z.string(),
  seq: z.number().int().nonnegative(),
  type: AttestationType,
  subjectId: z.string(),
  payloadHash: Hex64,
  payload: z.record(z.string(), z.unknown()),
  signer: z.object({ role: SignerRole, keyId: z.string() }),
  prevHash: z.union([Hex64, z.literal("GENESIS")]),
  hash: Hex64,
  signature: z.string(),
  createdAt: IsoDateTime,
});
export type Attestation = z.infer<typeof Attestation>;
