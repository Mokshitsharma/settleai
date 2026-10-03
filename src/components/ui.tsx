// Small, consistent UI primitives. Radius hierarchy: controls 6px, panels 10px, the seal is round.
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { formatMinor } from "@/core/money";

type Variant = "primary" | "secondary" | "danger" | "quiet";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-signal text-white hover:bg-signal-ink disabled:bg-ink-faint",
  secondary: "bg-surface text-ink border border-vellum hover:border-ink-faint disabled:text-ink-faint",
  danger: "bg-deny text-white hover:brightness-95 disabled:bg-ink-faint",
  quiet: "text-signal hover:text-signal-ink hover:bg-vellum/60",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
    />
  );
}

export function Panel({ children, className = "", as: Tag = "section" }: { children: ReactNode; className?: string; as?: "section" | "div" | "article" }) {
  return <Tag className={`rounded-[10px] border border-vellum bg-surface ${className}`}>{children}</Tag>;
}

export type Tone = "neutral" | "info" | "good" | "warn" | "bad";

const TONES: Record<Tone, string> = {
  neutral: "bg-vellum text-ink-soft",
  info: "bg-[#e6ebfe] text-signal-ink",
  good: "bg-seal-wash text-seal",
  warn: "bg-hold-wash text-hold",
  bad: "bg-deny-wash text-deny",
};

export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONES[tone]}`}>{children}</span>;
}

export function Money({ minor, className = "" }: { minor: number; className?: string }) {
  return <span className={`num ${className}`}>{formatMinor(minor)}</span>;
}

/** Hashes and ids are the only monospace text in the product. */
export function Hash({ value, chars = 12 }: { value: string; chars?: number }) {
  return (
    <code title={value} className="font-mono text-[0.8em] text-ink-soft">
      {value.length > chars ? `${value.slice(0, chars)}…` : value}
    </code>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-[10px] border border-dashed border-vellum px-6 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {children ? <div className="mt-2 text-sm text-ink-soft">{children}</div> : null}
    </div>
  );
}

const JOB_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  SCOPED: { label: "Ready to fund", tone: "info" },
  AWAITING_FUNDING: { label: "Awaiting PayPal", tone: "warn" },
  FUNDED: { label: "Funded, open to workers", tone: "good" },
  IN_PROGRESS: { label: "In progress", tone: "info" },
  DISPUTED: { label: "Disputed", tone: "bad" },
  COMPLETED: { label: "Completed", tone: "good" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

export function JobStatusPill({ status }: { status: string }) {
  const s = JOB_STATUS[status] ?? { label: status, tone: "neutral" as Tone };
  return <Pill tone={s.tone}>{s.label}</Pill>;
}

const MILESTONE_STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: "Not started", tone: "neutral" },
  ACTIVE: { label: "Active", tone: "info" },
  SUBMITTED: { label: "Proof submitted", tone: "info" },
  VERIFYING: { label: "Verifying", tone: "info" },
  APPROVED_AUTO: { label: "Approved by policy", tone: "good" },
  CHALLENGE_WINDOW: { label: "Challenge window", tone: "warn" },
  NEEDS_REVIEW: { label: "Needs review", tone: "warn" },
  HELD: { label: "Held", tone: "bad" },
  APPROVED_ADMIN: { label: "Approved by admin", tone: "good" },
  REJECTED: { label: "Rejected", tone: "bad" },
  RELEASING: { label: "Paying out", tone: "info" },
  RELEASED: { label: "Paid", tone: "good" },
  PAUSED_MANDATE: { label: "Paused: mandate revoked", tone: "bad" },
  DISPUTED: { label: "Disputed", tone: "bad" },
  RESOLVED: { label: "Resolved", tone: "good" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

export function MilestoneStatusPill({ status }: { status: string }) {
  const s = MILESTONE_STATUS[status] ?? { label: status, tone: "neutral" as Tone };
  return <Pill tone={s.tone}>{s.label}</Pill>;
}
