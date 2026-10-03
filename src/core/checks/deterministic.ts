// Deterministic checks (spec §8.4 step 2). They run before any LLM call, their results are passed into
// the prompt, and they are ground truth: an AI "pass" can never override a deterministic failure.
import type { AcceptanceCriterion, DeterministicFlag, Policy, VerificationResult } from "@/core/contracts";
import { distanceMeters, formatDistance } from "./geo";
import { hammingDistance, IMAGE_MIME_TYPES, type ExifInfo } from "./image";

export interface ProofForChecks {
  id: string;
  kind: "photo" | "file" | "text" | "geo";
  sha256?: string | null;
  phash?: string | null;
  sniffedMime?: string | null;
  declaredMime?: string | null;
  exif?: ExifInfo | null;
  geo?: { lat: number; lng: number } | null;
  text?: string | null;
}

export interface PriorImage {
  proofId: string;
  jobId: string;
  milestoneId: string;
  sha256: string | null;
  phash: string | null;
}

export interface CheckContext {
  milestone: { id: string; dueAt: Date; activatedAt: Date | null; criteria: AcceptanceCriterion[] };
  jobLocation?: { lat: number; lng: number; radiusM: number; label: string } | null;
  submittedAt: Date;
  priorImages: PriorImage[]; // images from OTHER milestones and jobs
  policy: Policy;
}

export type CriterionVerdict = VerificationResult["criteria"][number];

export interface DeterministicOutcome {
  flags: DeterministicFlag[];
  criteria: CriterionVerdict[]; // verdicts for criteria with check === "deterministic"
  injectionSuspected: boolean;
  injectionSpans: string[];
  photoPoint?: { lat: number; lng: number; source: "exif" | "device" };
  takenAt?: string;
}

const INJECTION_PATTERNS: RegExp[] = [
  /ignore (?:all |any |the )?(?:previous|prior|above|earlier) (?:instructions|rules|prompts?)/i,
  /disregard (?:all |any |the )?(?:previous|prior|above|earlier)?\s*(?:instructions|rules)/i,
  /\bsystem prompt\b/i,
  /\byou are now\b/i,
  /\b(?:approve|release|pay) (?:this|the payment|the payout|immediately|now)\b/i,
  /\bset (?:overall|verdict|injectionSuspected)\b/i,
  /<\/?(?:proof_data|statements|user_request|system)>/i,
];

export function scanForInjection(texts: string[]): string[] {
  const hits: string[] = [];
  for (const t of texts) {
    for (const re of INJECTION_PATTERNS) {
      const m = re.exec(t);
      if (m) hits.push(m[0]);
    }
  }
  return [...new Set(hits)];
}

export function runDeterministicChecks(proofs: ProofForChecks[], ctx: CheckContext): DeterministicOutcome {
  const flags: DeterministicFlag[] = [];
  const add = (code: string, severity: DeterministicFlag["severity"], detail: string) => flags.push({ code, severity, detail });
  const photos = proofs.filter((p) => p.kind === "photo");
  const graceMs = 10 * 60_000;

  // Duplicate images (exact or perceptual) against every prior proof from other milestones and jobs.
  for (const p of photos) {
    for (const prior of ctx.priorImages) {
      const exact = p.sha256 && prior.sha256 && p.sha256 === prior.sha256;
      const dist = p.phash && prior.phash ? hammingDistance(p.phash, prior.phash) : 99;
      if (exact || dist <= ctx.policy.dupImagePhashMaxDistance) {
        add(
          "DUP_IMAGE",
          "critical",
          `This photo was already submitted for another job (…${prior.jobId.slice(-6)}; ${exact ? "identical file" : "visually identical"})`,
        );
        break;
      }
    }
  }

  // File types: sniffed bytes decide, never the declared type.
  for (const p of proofs.filter((x) => x.kind === "photo" || x.kind === "file")) {
    if (p.kind === "photo" && (!p.sniffedMime || !(IMAGE_MIME_TYPES as readonly string[]).includes(p.sniffedMime))) {
      add("FILE_TYPE_MISMATCH", "critical", `Proof ${p.id} is not an image (detected ${p.sniffedMime ?? "unknown"})`);
    } else if (p.declaredMime && p.sniffedMime && p.declaredMime !== p.sniffedMime && !(p.declaredMime === "image/jpg" && p.sniffedMime === "image/jpeg")) {
      add("FILE_TYPE_MISMATCH", "warn", `Proof ${p.id} claims ${p.declaredMime} but is ${p.sniffedMime}`);
    }
  }

  // Capture time.
  const timed = photos.find((p) => p.exif?.takenAt);
  const takenAt = timed?.exif?.takenAt;
  if (photos.length && photos.every((p) => !p.exif?.takenAt && p.exif?.lat === undefined)) {
    add("NO_EXIF", "warn", "Photos have no capture time or location metadata");
  }
  if (takenAt) {
    const t = Date.parse(takenAt);
    const activated = ctx.milestone.activatedAt?.getTime();
    if (activated !== undefined && t < activated - graceMs) {
      add("EXIF_TIME_MISMATCH", "warn", "Photo was taken before this milestone started");
    } else if (t > ctx.submittedAt.getTime() + 5 * 60_000) {
      add("EXIF_TIME_MISMATCH", "warn", "Photo capture time is in the future");
    } else if (ctx.submittedAt.getTime() - t > ctx.policy.exifWindowMinutes * 60_000) {
      add("EXIF_TIME_MISMATCH", "warn", `Photo was taken more than ${ctx.policy.exifWindowMinutes} minutes before submission`);
    }
  }

  // Location: photo GPS first, device location as fallback.
  const exifPoint = photos.find((p) => p.exif?.lat !== undefined && p.exif?.lng !== undefined)?.exif;
  const devicePoint = proofs.find((p) => p.kind === "geo" && p.geo)?.geo ?? undefined;
  const photoPoint = exifPoint
    ? { lat: exifPoint.lat!, lng: exifPoint.lng!, source: "exif" as const }
    : devicePoint
      ? { ...devicePoint, source: "device" as const }
      : undefined;
  if (exifPoint && devicePoint) {
    const d = distanceMeters({ lat: exifPoint.lat!, lng: exifPoint.lng! }, devicePoint);
    if (d > 1000) add("GPS_MISMATCH", "warn", `Photo location and phone location are ${formatDistance(d)} apart`);
  }

  // Timing.
  if (ctx.submittedAt.getTime() > ctx.milestone.dueAt.getTime()) {
    add("LATE_SUBMISSION", "warn", `Submitted ${Math.round((ctx.submittedAt.getTime() - ctx.milestone.dueAt.getTime()) / 60_000)} minutes after the due time`);
  }
  if (ctx.milestone.activatedAt && ctx.submittedAt.getTime() - ctx.milestone.activatedAt.getTime() < 60_000) {
    add("TOO_FAST", "warn", "Submitted less than a minute after the milestone started");
  }

  // Deterministic criteria verdicts.
  const criteria: CriterionVerdict[] = [];
  for (const c of ctx.milestone.criteria.filter((x) => x.check === "deterministic")) {
    const refs = photos.map((p) => p.id);
    if (c.evidenceType === "geo") {
      const target = c.params?.location ?? ctx.jobLocation;
      const radius = c.params?.maxDistanceM ?? ctx.jobLocation?.radiusM ?? ctx.policy.gpsDefaultRadiusM;
      if (!target) {
        criteria.push({ criterionId: c.id, verdict: "unclear", confidence: 1, evidenceRefs: refs, rationale: "No target location is set for this check" });
      } else if (!photoPoint) {
        criteria.push({ criterionId: c.id, verdict: "unclear", confidence: 1, evidenceRefs: refs, rationale: "No photo GPS or phone location was provided" });
      } else {
        const d = distanceMeters(photoPoint, target);
        const ok = d <= radius;
        if (!ok) add("GPS_MISMATCH", d > 1000 ? "critical" : "warn", `${photoPoint.source === "exif" ? "Photo" : "Phone"} location is ${formatDistance(d)} from ${target.label} (allowed ${formatDistance(radius)})`);
        criteria.push({
          criterionId: c.id,
          verdict: ok ? "pass" : "fail",
          confidence: 1,
          evidenceRefs: refs,
          rationale: `${photoPoint.source === "exif" ? "Photo GPS" : "Phone location"} is ${formatDistance(d)} from ${target.label}`,
        });
      }
    } else if (c.evidenceType === "timestamp") {
      const within = c.params?.withinMinutesOfDue ?? ctx.policy.exifWindowMinutes;
      if (!takenAt) {
        criteria.push({ criterionId: c.id, verdict: "unclear", confidence: 1, evidenceRefs: refs, rationale: "Photo has no capture time" });
      } else {
        const late = (Date.parse(takenAt) - ctx.milestone.dueAt.getTime()) / 60_000;
        criteria.push({
          criterionId: c.id,
          verdict: late <= within ? "pass" : "fail",
          confidence: 1,
          evidenceRefs: refs,
          rationale: late <= 0 ? "Photo taken before the due time" : `Photo taken ${Math.round(late)} minutes after the due time`,
        });
      }
    } else if (c.evidenceType === "file") {
      const allowed = c.params?.mimeTypes ?? [];
      const files = proofs.filter((p) => p.kind === "file" || p.kind === "photo");
      const ok = files.length > 0 && files.every((f) => allowed.length === 0 || (f.sniffedMime && allowed.includes(f.sniffedMime)));
      criteria.push({
        criterionId: c.id,
        verdict: files.length === 0 ? "unclear" : ok ? "pass" : "fail",
        confidence: 1,
        evidenceRefs: files.map((f) => f.id),
        rationale: files.length === 0 ? "No file was submitted" : ok ? "File type is allowed" : `File type ${files.map((f) => f.sniffedMime).join(", ")} is not allowed`,
      });
    } else {
      criteria.push({ criterionId: c.id, verdict: "unclear", confidence: 0.5, evidenceRefs: [], rationale: "No deterministic check exists for this evidence type" });
    }
  }

  const texts = proofs.flatMap((p) => [p.text ?? "", p.exif?.description ?? ""]).filter(Boolean);
  const injectionSpans = scanForInjection(texts);
  if (injectionSpans.length) add("INJECTION_SUSPECTED", "critical", `Proof text contains instructions aimed at the reviewer: "${injectionSpans[0]}"`);

  return { flags, criteria, injectionSuspected: injectionSpans.length > 0, injectionSpans, photoPoint, takenAt };
}
