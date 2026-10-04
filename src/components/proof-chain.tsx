// Proof Chain viewer (spec §13.2): the job's signed attestations, linked by hash, oldest first.
import type { Attestation } from "@/core/contracts";

const LABEL: Record<string, string> = {
  mandate: "Mandate",
  evidence: "Evidence",
  verification: "Verification",
  decision: "Decision",
  release: "Release scheduled",
  settlement: "Settled",
  dispute: "Dispute",
  revocation: "Revocation",
  denial: "Denied",
};

const COLOR: Record<string, string> = {
  settlement: "var(--seal)",
  denial: "var(--deny)",
  revocation: "var(--deny)",
  dispute: "var(--hold)",
  decision: "var(--signal)",
};

function describe(a: Attestation): string {
  const p = a.payload as Record<string, unknown>;
  switch (a.type) {
    case "mandate":
      return p.event === "worker_countersigned" ? "Worker countersigned the job mandate" : `${String(p.mandateType)} mandate recorded`;
    case "evidence":
      return p.kind === "funding_captured" ? "PayPal capture confirmed" : `${String(p.kind)} proof received${p.milestoneSeq ? ` for milestone ${p.milestoneSeq}` : ""}`;
    case "verification":
      return `Milestone ${p.milestoneSeq}: verification ${String(p.overall)}`;
    case "decision":
      return `Milestone ${p.milestoneSeq}: ${String(p.decision).replaceAll("_", " ").toLowerCase()}`;
    case "release":
      return `Milestone ${p.milestoneSeq}: payout scheduled after the challenge window`;
    case "settlement":
      return p.event === "dispute_settled" ? `Dispute settled (${String(p.faultClass).replaceAll("_", " ").toLowerCase()})` : `Milestone ${p.milestoneSeq}: paid out via PayPal`;
    case "dispute":
      return `Dispute ${String(p.event).replaceAll("_", " ")}`;
    case "revocation":
      return `Mandate revoked; milestone ${p.milestoneSeq} paused`;
    case "denial":
      return `Mandate Guard denied ${String(p.action)}`;
    default:
      return a.type;
  }
}

export function ProofChainView({ chain, ok }: { chain: Attestation[]; ok: boolean }) {
  return (
    <div>
      <p className={`text-sm font-semibold ${ok ? "text-seal" : "text-deny"}`}>
        {ok ? `All ${chain.length} links verify` : "The chain does not verify"}
      </p>
      <ol className="mt-3 space-y-0">
        {chain.map((a, i) => (
          <li key={a.id} className="relative flex gap-3 pb-3">
            {i < chain.length - 1 ? <span aria-hidden className="absolute left-[5px] top-4 h-full w-px bg-vellum" /> : null}
            <span aria-hidden className="relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full border-2 bg-surface" style={{ borderColor: COLOR[a.type] ?? "var(--ink-faint)" }} />
            <div className="min-w-0 text-sm">
              <p>
                <span className="font-semibold">{LABEL[a.type] ?? a.type}</span>: {describe(a)}
              </p>
              <p className="text-xs text-ink-faint">
                <span className="num">#{a.seq}</span> signed by {a.signer.role}{" "}
                <code className="font-mono" title={a.hash}>
                  {a.hash.slice(0, 12)}
                </code>
                {i > 0 ? (
                  <>
                    {" "}
                    links{" "}
                    <code className="font-mono" title={a.prevHash}>
                      {a.prevHash.slice(0, 8)}
                    </code>
                  </>
                ) : null}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
