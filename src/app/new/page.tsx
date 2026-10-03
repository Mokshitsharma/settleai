import type { Metadata } from "next";
import { pageUser } from "@/lib/page-auth";
import { ScopeStudio } from "./scope-studio";

export const metadata: Metadata = { title: "New job" };

export default async function NewJobPage() {
  await pageUser(["payer"]);
  return (
    <main>
      <h1 className="text-3xl font-bold tracking-tight">Describe the job</h1>
      <p className="mt-1 max-w-[62ch] text-ink-soft">
        Write it the way you would tell a person. The scoping agent turns it into paid milestones with checks a worker can prove. You edit
        everything before any money moves.
      </p>
      <ScopeStudio />
    </main>
  );
}
