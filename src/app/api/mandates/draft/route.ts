import { z } from "zod";
import { getContainer } from "@/core/container";
import { Category } from "@/core/contracts";
import { handle, readJson, requireUser } from "../../_lib";

const DraftBody = z.object({
  keyId: z.string().min(1),
  agentClientId: z.string().min(1),
  categories: z.array(Category).min(1),
  maxPerJobMinor: z.number().int().positive(),
  maxTotalMinor: z.number().int().positive(),
  maxJobsPerDay: z.number().int().min(1).max(100),
  ttlSeconds: z.number().int().min(60).max(30 * 24 * 3600),
  geoFence: z.object({ lat: z.number(), lng: z.number(), radiusKm: z.number().positive(), label: z.string().optional() }).optional(),
  minTrustScore: z.number().int().min(0).max(100),
  requirePayPalEmail: z.boolean(),
  prohibitedKeywords: z.array(z.string().trim().min(1)).max(20).optional(),
  stepUpAboveMinor: z.number().int().nonnegative(),
  maxAutoReleaseMinor: z.number().int().nonnegative(),
});

/** Server-built Intent Mandate draft + plain-language preview, for the human to sign. */
export const POST = handle(async (req: Request) => {
  const user = await requireUser(["payer"]);
  const body = await readJson(req, DraftBody);
  const c = await getContainer();
  const draft = await c.mandates.draftIntent({
    ...body,
    issuerUserId: user.id,
    maxChallengeWindowSeconds: c.config.CHALLENGE_WINDOW_SECONDS,
  });
  return Response.json(draft);
});
