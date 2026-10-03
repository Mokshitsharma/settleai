import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type DbHandle } from "@/core/db/client";
import { auditLog } from "@/core/db/schema";
import { AuditService } from "@/core/services/audit";

let h: DbHandle;
let audit: AuditService;

beforeAll(async () => {
  h = await openTestDb();
  audit = new AuditService(h.db);
});
afterAll(() => h.close());

describe("audit hash chain", () => {
  it("appends linked entries and verifies", async () => {
    const a = await audit.append({ actor: "system", action: "job.created", entityType: "job", entityId: "job_1", payload: { total: 10000 } });
    const b = await audit.append({ actor: "user:usr_ravi", action: "job.funded", entityType: "job", entityId: "job_1", payload: {} });
    expect(a.seq).toBe(1);
    expect(b.seq).toBe(2);
    expect(await audit.verifyChain()).toEqual({ ok: true, checked: 2 });
  });

  it("serializes concurrent appends without gaps", async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        audit.append({ actor: "system", action: "tick", entityType: "test", entityId: String(i), payload: { i } }),
      ),
    );
    const result = await audit.verifyChain();
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(12);
  });

  it("detects a tampered payload and points to the entry", async () => {
    await h.db.update(auditLog).set({ payloadJson: { total: 99999 } }).where(eq(auditLog.seq, 1));
    expect(await audit.verifyChain()).toMatchObject({ ok: false, brokenAtSeq: 1, reason: "hash mismatch (entry altered)" });
  });

  it("detects a deleted entry", async () => {
    await h.db.execute(sql`delete from audit_log`);
    await audit.append({ actor: "system", action: "a", entityType: "t", entityId: "1", payload: {} });
    await audit.append({ actor: "system", action: "b", entityType: "t", entityId: "2", payload: {} });
    await audit.append({ actor: "system", action: "c", entityType: "t", entityId: "3", payload: {} });
    await h.db.delete(auditLog).where(eq(auditLog.seq, 2));
    expect((await audit.verifyChain()).ok).toBe(false);
  });
});
