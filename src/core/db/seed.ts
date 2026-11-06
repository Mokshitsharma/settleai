// Seed skeleton (T003). Full demo history, proof fixtures and the ProcureBot mandates arrive in T141.
import { count } from "drizzle-orm";
import defaultPolicy from "@/core/policy/default.json";
import { Policy } from "@/core/contracts";
import type { Db } from "./client";
import { auditLog, policies, users } from "./schema";
import { LedgerService } from "@/core/services/ledger";
import { AuditService } from "@/core/services/audit";

export const SEED_USERS = [
  { id: "usr_ravi", email: "ravi@settleai.demo", name: "Ravi Traders", role: "payer", trustScore: 50, paypalEmail: null },
  { id: "usr_asha", email: "asha@settleai.demo", name: "Asha K.", role: "worker", trustScore: 62, paypalEmail: "asha.worker@example.com" },
  { id: "usr_dev", email: "dev@settleai.demo", name: "Dev M.", role: "worker", trustScore: 35, paypalEmail: "dev.worker@example.com" },
  { id: "usr_meera", email: "meera@settleai.demo", name: "Meera", role: "admin", trustScore: 50, paypalEmail: null },
] as const;

export async function seed(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    // SANDBOX_WORKER_EMAIL points payouts at a real PayPal sandbox account in LIVE mode.
    const sandboxWorker = process.env.SANDBOX_WORKER_EMAIL;
    await tx
      .insert(users)
      .values(SEED_USERS.map((u) => ({ ...u, paypalEmail: u.paypalEmail && sandboxWorker ? sandboxWorker : u.paypalEmail })))
      .onConflictDoNothing();
    const policy = Policy.parse(defaultPolicy);
    await tx
      .insert(policies)
      .values({ id: `pol_v${policy.version}`, version: policy.version, json: policy, active: true, createdBy: "system" })
      .onConflictDoNothing();
    await new LedgerService(db).ensureSystemAccounts(tx);
    const [{ n }] = await tx.select({ n: count() }).from(auditLog);
    if (n === 0) {
      await new AuditService(db).append(
        { actor: "system", action: "system.seeded", entityType: "system", entityId: "seed", payload: { policyVersion: policy.version } },
        tx,
      );
    }
  });
}
