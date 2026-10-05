import { desc, eq, max } from "drizzle-orm";
import type { Db, DbOrTx } from "@/core/db/client";
import { policies } from "@/core/db/schema";
import { Policy } from "@/core/contracts";
import defaultPolicy from "@/core/policy/default.json";
import type { AuditService } from "./audit";

/** Active, versioned risk policy (one active row). Falls back to the bundled default. */
export class PolicyService {
  constructor(
    private readonly db: Db,
    private readonly audit?: AuditService,
  ) {}

  /** Saves a new version and makes it the only active one. Earlier versions stay for history and audit. */
  async save(args: { json: unknown; adminId: string; note: string }): Promise<Policy> {
    const current = await this.active();
    return this.db.transaction(async (tx) => {
      const [{ v }] = await tx.select({ v: max(policies.version) }).from(policies);
      const version = (v ?? 0) + 1;
      const policy = Policy.parse({ ...(args.json as object), version });
      await tx.update(policies).set({ active: false }).where(eq(policies.active, true));
      await tx.insert(policies).values({ id: `pol_v${version}`, version, json: policy, active: true, createdBy: `admin:${args.adminId}` });
      await this.audit?.append(
        { actor: `admin:${args.adminId}`, action: "policy.updated", entityType: "policy", entityId: `pol_v${version}`, payload: { from: current.version, to: version, note: args.note, changes: diffPolicy(current, policy) } },
        tx,
      );
      return policy;
    });
  }

  async history(): Promise<{ version: number; active: boolean; createdBy: string; createdAt: string; json: Policy }[]> {
    const rows = await this.db.select().from(policies).orderBy(desc(policies.version));
    return rows.map((r) => ({ version: r.version, active: r.active, createdBy: r.createdBy, createdAt: r.createdAt.toISOString(), json: r.json as Policy }));
  }

  async active(t: DbOrTx = this.db): Promise<Policy> {
    const [row] = await t.select().from(policies).where(eq(policies.active, true));
    return Policy.parse(row?.json ?? defaultPolicy);
  }
}

/** Flat list of changed settings between two policy versions, e.g. "reviewAt: 25 -> 20". */
export function diffPolicy(a: Policy, b: Policy): string[] {
  const out: string[] = [];
  const walk = (x: unknown, y: unknown, prefix: string) => {
    if (x && y && typeof x === "object" && typeof y === "object" && !Array.isArray(x)) {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y as object)])) {
        if (k === "version") continue;
        walk((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k], prefix ? `${prefix}.${k}` : k);
      }
    } else if (JSON.stringify(x) !== JSON.stringify(y)) {
      out.push(`${prefix}: ${JSON.stringify(x)} -> ${JSON.stringify(y)}`);
    }
  };
  walk(a, b, "");
  return out;
}
