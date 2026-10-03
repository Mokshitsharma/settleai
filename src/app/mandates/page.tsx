import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getContainer } from "@/core/container";
import { apiClients } from "@/core/db/schema";
import { pageUser } from "@/lib/page-auth";
import { MandateComposer } from "./mandate-composer";
import { MandateCard } from "./mandate-card";
import { EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Agent mandates" };
export const dynamic = "force-dynamic";

export default async function MandatesPage() {
  const user = await pageUser(["payer"]);
  const c = await getContainer();
  const [mandates, clients] = await Promise.all([
    c.mandates.listForIssuer(user.id),
    c.dbHandle.db.select({ id: apiClients.id, name: apiClients.name }).from(apiClients).where(eq(apiClients.ownerUserId, user.id)),
  ]);
  const active = mandates.filter((m) => m.status === "active");
  const ended = mandates.filter((m) => m.status !== "active");

  return (
    <main>
      <h1 className="text-3xl font-bold tracking-tight">What your agents may buy</h1>
      <p className="mt-1 max-w-[64ch] text-ink-soft">
        A mandate is a signed permission for one AI agent. SettleAI checks every hire and every payout against it. Anything outside it is
        refused before money moves, and revoking it stops pending payouts.
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section>
          <h2 className="text-lg font-semibold">Give an agent permission</h2>
          <MandateComposer userId={user.id} clients={clients} keyMode={c.config.KEY_MODE} />
        </section>
        <section>
          <h2 className="text-lg font-semibold">Active</h2>
          <div className="mt-3 space-y-4">
            {active.length ? active.map((m) => <MandateCard key={m.id} mandate={m} />) : <EmptyState title="No active mandates" />}
          </div>
          {ended.length ? (
            <>
              <h2 className="mt-8 text-lg font-semibold">Ended</h2>
              <div className="mt-3 space-y-4">
                {ended.map((m) => (
                  <MandateCard key={m.id} mandate={m} />
                ))}
              </div>
            </>
          ) : null}
        </section>
      </div>
    </main>
  );
}
