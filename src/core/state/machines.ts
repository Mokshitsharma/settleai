// Explicit transition tables (spec §10). Illegal transitions throw; webhook handlers use canTransition
// to ignore events that arrive late or out of order.

type Table<S extends string> = Record<S, readonly S[]>;

export const JOB = {
  DRAFT: ["SCOPED", "CANCELLED"],
  SCOPED: ["AWAITING_FUNDING", "SCOPED", "CANCELLED"],
  AWAITING_FUNDING: ["FUNDED", "SCOPED", "CANCELLED"],
  FUNDED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "DISPUTED", "CANCELLED"],
  DISPUTED: ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
} as const satisfies Table<string>;
export type JobStatus = keyof typeof JOB;

export const MILESTONE = {
  PENDING: ["ACTIVE"],
  ACTIVE: ["SUBMITTED"],
  SUBMITTED: ["VERIFYING", "DISPUTED"],
  VERIFYING: ["APPROVED_AUTO", "NEEDS_REVIEW", "HELD", "REJECTED"],
  APPROVED_AUTO: ["CHALLENGE_WINDOW", "PAUSED_MANDATE"],
  CHALLENGE_WINDOW: ["RELEASING", "DISPUTED", "PAUSED_MANDATE"],
  NEEDS_REVIEW: ["APPROVED_ADMIN", "REJECTED"],
  HELD: ["APPROVED_ADMIN", "REJECTED"],
  APPROVED_ADMIN: ["RELEASING", "PAUSED_MANDATE"],
  REJECTED: ["ACTIVE", "DISPUTED"],
  RELEASING: ["RELEASED", "PAUSED_MANDATE"],
  PAUSED_MANDATE: ["RELEASING", "CANCELLED"],
  DISPUTED: ["RESOLVED"],
  RELEASED: [],
  RESOLVED: [],
  CANCELLED: [],
} as const satisfies Table<string>;
export type MilestoneStatus = keyof typeof MILESTONE;

export const RELEASE = {
  CREATED: ["WAITING_WINDOW", "PAYOUT_PENDING", "CANCELLED"],
  WAITING_WINDOW: ["PAYOUT_PENDING", "CANCELLED"],
  PAYOUT_PENDING: ["PAYOUT_SUCCEEDED", "PAYOUT_FAILED"],
  PAYOUT_FAILED: ["PAYOUT_PENDING", "CANCELLED"],
  PAYOUT_SUCCEEDED: [],
  CANCELLED: [],
} as const satisfies Table<string>;
export type ReleaseStatus = keyof typeof RELEASE;

export const PAYOUT = {
  CREATED: ["PROCESSING", "SUCCEEDED", "FAILED", "BLOCKED", "RETURNED", "UNCLAIMED", "ONHOLD"],
  PROCESSING: ["SUCCEEDED", "FAILED", "BLOCKED", "RETURNED", "UNCLAIMED", "ONHOLD"],
  ONHOLD: ["SUCCEEDED", "FAILED", "BLOCKED", "RETURNED"],
  UNCLAIMED: ["SUCCEEDED", "RETURNED"],
  SUCCEEDED: ["REFUNDED", "REVERSED"],
  FAILED: [],
  BLOCKED: [],
  RETURNED: [],
  REFUNDED: [],
  REVERSED: [],
} as const satisfies Table<string>;
export type PayoutStatus = keyof typeof PAYOUT;

export const DISPUTE = {
  OPEN: ["EVIDENCE_WINDOW"],
  EVIDENCE_WINDOW: ["AI_PROPOSED", "ESCALATED"],
  AI_PROPOSED: ["ACCEPTED_BOTH", "ESCALATED"],
  ACCEPTED_BOTH: ["EXECUTED"],
  ESCALATED: ["ADMIN_RESOLVED"],
  ADMIN_RESOLVED: ["EXECUTED"],
  EXECUTED: [],
} as const satisfies Table<string>;
export type DisputeStatus = keyof typeof DISPUTE;

export const FUNDING = {
  CREATED: ["APPROVED", "CAPTURED", "FAILED"],
  APPROVED: ["CAPTURED", "FAILED"],
  CAPTURED: ["CONFIRMED", "FAILED"],
  CONFIRMED: [],
  FAILED: [],
} as const satisfies Table<string>;
export type FundingStatus = keyof typeof FUNDING;

export const MANDATE = {
  draft: ["active"],
  active: ["consumed", "exhausted", "expired", "revoked"],
  consumed: [],
  exhausted: ["revoked"],
  expired: [],
  revoked: [],
} as const satisfies Table<string>;

export const MACHINES = { JOB, MILESTONE, RELEASE, PAYOUT, DISPUTE, FUNDING, MANDATE } as const;
export type MachineName = keyof typeof MACHINES;

export class IllegalTransitionError extends Error {
  constructor(
    readonly machine: MachineName,
    readonly from: string,
    readonly to: string,
  ) {
    super(`Illegal ${machine} transition ${from} -> ${to}`);
  }
}

export function canTransition(machine: MachineName, from: string, to: string): boolean {
  const table = MACHINES[machine] as Record<string, readonly string[]>;
  return (table[from] ?? []).includes(to);
}

export function assertTransition(machine: MachineName, from: string, to: string): void {
  if (!canTransition(machine, from, to)) throw new IllegalTransitionError(machine, from, to);
}
