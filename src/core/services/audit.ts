// Hash-chained audit log (F11). hash = sha256(prevHash + canonical(entry)), where entry covers
// seq, actor, action, entity and payload, so none of them can be altered without breaking the chain.
import { asc, desc, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "@/core/db/client";
import { auditLog } from "@/core/db/schema";
import { newId } from "@/core/ids";
import { canonicalize, sha256Hex } from "@/core/mandates/canonical";

export const AUDIT_GENESIS = "GENESIS";
// Arbitrary constant key for pg_advisory_xact_lock so appends are serialized across connections.
const AUDIT_LOCK_KEY = 7_311_001;

export interface AuditInput {
  actor: string; // user:<id> | admin:<id> | agent:<name> | api_client:<id> | system
  action: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
}

export function auditHash(prevHash: string, seq: number, input: AuditInput): string {
  const { actor, action, entityType, entityId, payload } = input;
  return sha256Hex(prevHash + canonicalize({ seq, actor, action, entityType, entityId, payload }));
}

export interface ChainVerification {
  ok: boolean;
  checked: number;
  brokenAtSeq?: number;
  reason?: string;
}

export class AuditService {
  constructor(private readonly db: Db) {}

  async append(input: AuditInput, tx?: DbOrTx): Promise<{ seq: number; hash: string }> {
    const run = async (t: DbOrTx) => {
      await t.execute(sql`select pg_advisory_xact_lock(${AUDIT_LOCK_KEY})`);
      const [last] = await t.select().from(auditLog).orderBy(desc(auditLog.seq)).limit(1);
      const seq = (last?.seq ?? 0) + 1;
      const prevHash = last?.hash ?? AUDIT_GENESIS;
      const hash = auditHash(prevHash, seq, input);
      await t.insert(auditLog).values({
        id: newId("aud"),
        seq,
        actor: input.actor,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        payloadJson: input.payload,
        prevHash,
        hash,
      });
      return { seq, hash };
    };
    return tx ? run(tx) : this.db.transaction(run);
  }

  async verifyChain(t: DbOrTx = this.db): Promise<ChainVerification> {
    const rows = await t.select().from(auditLog).orderBy(asc(auditLog.seq));
    let prevHash = AUDIT_GENESIS;
    for (const [i, row] of rows.entries()) {
      const expectedSeq = i + 1;
      if (row.seq !== expectedSeq) return { ok: false, checked: i, brokenAtSeq: row.seq, reason: `gap: expected seq ${expectedSeq}` };
      if (row.prevHash !== prevHash) return { ok: false, checked: i, brokenAtSeq: row.seq, reason: "prev_hash does not link" };
      const expected = auditHash(prevHash, row.seq, {
        actor: row.actor,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        payload: row.payloadJson as Record<string, unknown>,
      });
      if (expected !== row.hash) return { ok: false, checked: i, brokenAtSeq: row.seq, reason: "hash mismatch (entry altered)" };
      prevHash = row.hash;
    }
    return { ok: true, checked: rows.length };
  }
}
