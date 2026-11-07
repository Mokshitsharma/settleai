import { readFile } from "node:fs/promises";
import { count, desc, sql } from "drizzle-orm";
import { webhookEvents } from "@/core/db/schema";
import { getContainer } from "@/core/container";

export const dynamic = "force-dynamic";

/** Health for Render and judges: mode, DB status, LLM provider, ledger and audit integrity. */
export async function GET() {
  try {
    const c = await getContainer();
    await c.dbHandle.db.execute(sql`select 1`);
    const [ledgerProblems, auditChain] = await Promise.all([c.ledger.checkInvariants(), c.audit.verifyChain()]);
    const [verifiedWebhooks] = await c.dbHandle.db.select({ n: count() }).from(webhookEvents);
    const [lastWebhook] = await c.dbHandle.db.select({ eventType: webhookEvents.eventType, createdAt: webhookEvents.createdAt }).from(webhookEvents).orderBy(desc(webhookEvents.createdAt)).limit(1);
    return Response.json({
      status: "ok",
      mode: c.config.mode,
      payments: c.payments.mode,
      llm: { provider: c.llm.provider, model: c.llm.model },
      db: { status: "ok", driver: c.dbHandle.driver },
      ledger: { invariantsOk: ledgerProblems.length === 0, problems: ledgerProblems },
      audit: auditChain,
      // Only events whose signature verified are stored, so this is evidence of real, verified PayPal delivery.
      webhooks: { verifiedEvents: verifiedWebhooks.n, lastEventType: lastWebhook?.eventType ?? null, lastEventAt: lastWebhook?.createdAt ?? null },
      memoryMb: {
        rss: Math.round(process.memoryUsage().rss / 1048576),
        peakRss: Math.round(process.resourceUsage().maxRSS / 1024),
        bootPeakRss: Number(await readFile(".data/boot-peak-rss-mb", "utf8").catch(() => "")) || null,
      },
    });
  } catch (err) {
    return Response.json({ status: "error", error: (err as Error).message }, { status: 503 });
  }
}
