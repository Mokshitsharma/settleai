import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/core/auth/session";
import { hashCanonical } from "@/core/mandates/canonical";
import { RoleSwitcher } from "@/components/role-switcher";
import { Seal } from "@/components/seal";

const SAMPLE_MANDATE =
  "Allow ProcureBot to hire delivery services within 25 km of Indore, up to $150 per job and $400 in total. Payments are released only after the work is verified. I must approve any job above $100. I can revoke this at any time.";

const STEPS = [
  { title: "You sign what the agent may buy", body: "Categories, caps, area and expiry, in one plain sentence signed by your key." },
  { title: "PayPal holds the money", body: "The job is funded through PayPal Checkout and held in escrow before anyone starts." },
  { title: "Proof is checked, not trusted", body: "Location, time and duplicate-photo checks run first; then an AI verifies each criterion." },
  { title: "PayPal pays, or nobody does", body: "Policy releases the payout, holds it for review, or blocks it. Every step is signed." },
];

const MOMENTS = [
  { title: "An agent is stopped before money moves", how: "Payer, Agent mandates, Out of scope, Send as agent: denied with reason codes, nothing created." },
  { title: "A reused photo is caught", how: "Worker, on a funded job, Submit proof, Photo reused from another job: held for a person." },
  { title: "A dispute names who is liable", how: "Payer, Dispute this milestone in the challenge window: a split and a finding that cites the mandate." },
  { title: "A receipt anyone can check", how: "Open the showcase receipt or any job's receipt, Verify; change one byte and it fails." },
];

export default async function Home() {
  const user = await currentUser();
  if (user) redirect("/jobs");
  return (
    <main className="py-6 sm:py-12">
      <section className="grid items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <h1 className="max-w-[16ch] text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
            Agents will hire people. Who answers for it?
          </h1>
          <p className="mt-6 max-w-[56ch] text-lg leading-relaxed text-ink-soft">
            SettleAI lets an AI agent hire couriers, designers and repair people within limits you sign. The money waits in PayPal until the
            work is proven, and every decision leaves a receipt anyone can verify.
          </p>
          <div className="mt-8">
            <p className="mb-3 text-sm font-medium text-ink-soft">Try the demo as</p>
            <RoleSwitcher size="large" />
            <p className="mt-3 text-sm">
              <Link href="/receipt/showcase" className="font-semibold text-signal underline">
                See a settled job&apos;s signed receipt
              </Link>
            </p>
            <p className="mt-3 text-sm text-ink-soft">First load may take ~75s while the free server wakes up.</p>
          </div>
        </div>

        <figure className="relative rounded-[10px] border border-vellum bg-surface p-7 shadow-[0_1px_0_var(--vellum),0_18px_40px_-24px_rgba(20,33,61,0.35)]">
          <figcaption className="flex items-baseline justify-between text-sm text-ink-soft">
            <span className="font-semibold text-ink">Intent mandate</span>
            <span>signed by Ravi Traders</span>
          </figcaption>
          <blockquote className="mt-5 text-xl leading-snug">{SAMPLE_MANDATE}</blockquote>
          <div className="mt-6 flex items-end justify-between border-t border-vellum pt-4 text-sm">
            <div className="text-ink-soft">
              <p>Valid until tomorrow, 6:00 pm IST</p>
              <p className="mt-1">$0 of $400 spent</p>
            </div>
            <Seal hash={hashCanonical(SAMPLE_MANDATE)} label="Signed ES256" size={104} animate />
          </div>
        </figure>
      </section>

      <section className="mt-16">
        <h2 className="text-lg font-semibold">Four things to try</h2>
        <ol className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {MOMENTS.map((m, i) => (
            <li key={m.title} className="rounded-[10px] border border-vellum bg-surface p-5">
              <span className="num text-sm font-semibold text-signal">{i + 1}</span>
              <h3 className="mt-1 font-semibold">{m.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">{m.how}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-16 border-t border-vellum pt-10">
        <h2 className="text-lg font-semibold">How a job settles</h2>
        <ol className="mt-6 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <span className="num text-sm font-semibold text-signal">{i + 1}</span>
              <h3 className="mt-1 font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
