import { z } from "zod";
import { Category, Currency, IsoDateTime, MinorAmount } from "./common";

export const AcceptanceCriterion = z.object({
  id: z.string().regex(/^c\d+$/),
  text: z.string().min(1),
  evidenceType: z.enum(["photo", "file", "text", "geo", "timestamp", "external_link"]),
  check: z.enum(["deterministic", "ai_visual", "ai_text", "human"]),
  params: z
    .object({
      maxDistanceM: z.number().positive().optional(),
      withinMinutesOfDue: z.number().positive().optional(),
      mimeTypes: z.array(z.string()).optional(),
      requiredSections: z.array(z.string()).optional(),
      // Where this criterion's proof must be taken (e.g. the pickup point). Defaults to the job location.
      location: z.object({ lat: z.number(), lng: z.number(), label: z.string() }).optional(),
    })
    .optional(),
});
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterion>;

export const Milestone = z.object({
  seq: z.number().int().positive(),
  title: z.string().min(1),
  description: z.string(),
  amountMinor: MinorAmount,
  dueAt: IsoDateTime,
  acceptanceCriteria: z.array(AcceptanceCriterion).min(1).max(5),
});
export type Milestone = z.infer<typeof Milestone>;

export const JobSpec = z
  .object({
    title: z.string().min(1),
    category: Category,
    summary: z.string(),
    currency: Currency,
    totalAmountMinor: MinorAmount,
    location: z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        radiusM: z.number().positive(),
        label: z.string(),
      })
      .optional(),
    milestones: z.array(Milestone).min(1),
    clarifyingQuestions: z.array(z.string()).max(3),
    riskNotes: z.array(z.string()),
    confidence: z.number().min(0).max(1),
  })
  .refine((s) => s.milestones.reduce((a, m) => a + m.amountMinor, 0) === s.totalAmountMinor, {
    message: "totalAmountMinor must equal the sum of milestone amounts",
    path: ["totalAmountMinor"],
  });
export type JobSpec = z.infer<typeof JobSpec>;
