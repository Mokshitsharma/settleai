import { sql } from "drizzle-orm";
import { getContainer } from "@/core/container";

export const dynamic = "force-dynamic";

/** Health for Render and judges: mode, DB status, LLM provider, ledger and audit integrity. */
export async function GET() {
  try {
    const c = await getContainer();
    await c.dbHandle.db.execute(sql`select 1`);
    const [ledgerProblems, auditChain] = await Promise.all([c.ledger.checkInvariants(), c.audit.verifyChain()]);
    return Response.json({
      status: "ok",
      mode: c.config.mode,
      payments: c.payments.mode,
      llm: { provider: c.llm.provider, model: c.llm.model },
      db: { status: "ok", driver: c.dbHandle.driver },
      ledger: { invariantsOk: ledgerProblems.length === 0, problems: ledgerProblems },
      audit: auditChain,
    });
  } catch (err) {
    return Response.json({ status: "error", error: (err as Error).message }, { status: 503 });
  }
}
