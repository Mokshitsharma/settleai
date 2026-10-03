import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import type { AcceptanceCriterion, JobSpec } from "@/core/contracts";
import { getContainer } from "@/core/container";
import { jobs, milestones } from "@/core/db/schema";
import { pageUser } from "@/lib/page-auth";
import { ProofForm } from "./proof-form";

export const metadata: Metadata = { title: "Submit proof" };
export const dynamic = "force-dynamic";

export default async function SubmitProofPage({ params }: PageProps<"/worker/submit/[milestoneId]">) {
  const user = await pageUser(["worker"]);
  const { milestoneId } = await params;
  const c = await getContainer();
  const [ms] = await c.dbHandle.db.select().from(milestones).where(eq(milestones.id, milestoneId));
  if (!ms) notFound();
  const [job] = await c.dbHandle.db.select().from(jobs).where(eq(jobs.id, ms.jobId));
  if (job.workerId !== user.id) redirect("/jobs");
  if (ms.status !== "ACTIVE" && ms.status !== "REJECTED") redirect(`/jobs/${job.id}`);
  const criteria = ms.criteriaJson as AcceptanceCriterion[];
  const spec = job.specJson as JobSpec;
  const geo = criteria.find((x) => x.evidenceType === "geo");
  const place = geo?.params?.location?.label ?? spec.location?.label;

  return (
    <main className="mx-auto max-w-lg">
      <p className="text-sm text-ink-soft">{job.title}</p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">
        Milestone {ms.seq}: {ms.title}
      </h1>
      {place ? <p className="mt-1 text-ink-soft">Take the photos at {place}.</p> : null}
      {ms.status === "REJECTED" ? (
        <p className="mt-3 rounded-md bg-deny-wash px-3 py-2 text-sm text-deny">Your last proof was rejected. Send new proof taken at the job.</p>
      ) : null}
      <ProofForm milestoneId={ms.id} jobId={job.id} criteria={criteria} />
    </main>
  );
}
