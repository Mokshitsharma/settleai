import { z } from "zod";

export const SignalCode = z.enum([
  "LOW_VERIFICATION_CONFIDENCE",
  "CRITERION_UNCLEAR",
  "CRITERION_FAIL",
  "DUP_IMAGE",
  "GPS_MISMATCH",
  "EXIF_TIME_MISMATCH",
  "NO_EXIF",
  "INJECTION_SUSPECTED",
  "AMOUNT_ANOMALY",
  "LOW_TRUST",
  "HIGH_TRUST",
  "FIRST_TIME_PAIR",
  "PAYOUT_DEST_RECENT",
  "VELOCITY",
  "PAYER_DISPUTE_RATE",
]);
export type SignalCode = z.infer<typeof SignalCode>;

export const Policy = z
  .object({
    version: z.number().int().positive(),
    holdAt: z.number().min(0).max(100),
    reviewAt: z.number().min(0).max(100),
    autoReleaseMinConfidence: z.number().min(0).max(1),
    baseChallengeWindowSeconds: z.number().int().nonnegative(),
    maxAutoReleaseAmountMinor: z.number().int().nonnegative(),
    payoutDestRecentHours: z.number().nonnegative(),
    dupImagePhashMaxDistance: z.number().int().nonnegative(),
    gpsDefaultRadiusM: z.number().positive(),
    exifWindowMinutes: z.number().positive(),
    weights: z.record(SignalCode, z.number()),
    hardHoldFlags: z.array(z.string()),
    forceReviewFlags: z.array(z.string()),
    trustDeltas: z.object({
      release_success: z.number(),
      dispute_won: z.number(),
      dispute_lost: z.number(),
      fraud_confirmed: z.number(),
    }),
  })
  .refine((p) => p.reviewAt < p.holdAt, { message: "reviewAt must be below holdAt" });
export type Policy = z.infer<typeof Policy>;
