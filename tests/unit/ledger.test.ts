import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type DbHandle } from "@/core/db/client";
import { jobs, users } from "@/core/db/schema";
import { ACCOUNTS, LedgerError, LedgerService, escrowCode, validateLines } from "@/core/services/ledger";

let h: DbHandle;
let ledger: LedgerService;

async function makeJob(id: string) {
  await h.db.insert(jobs).values({
    id,
    payerId: "usr_ravi",
    title: "Test job",
    category: "delivery",
    specJson: {},
    totalMinor: 10000,
    feeMinor: 200,
    createdBy: "user:usr_ravi",
  });
}

beforeAll(async () => {
  h = await openTestDb();
  ledger = new LedgerService(h.db);
  await h.db.insert(users).values({ id: "usr_ravi", email: "ravi@example.com", name: "Ravi Traders", role: "payer" });
});
afterAll(() => h.close());

describe("ledger", () => {
  it("follows the Section 11.1 worked example", async () => {
    await makeJob("job_a");
    await ledger.recordFunding({ jobId: "job_a", fundingId: "fund_a", amountMinor: 10200 });
    await ledger.recordRelease({ jobId: "job_a", releaseId: "rel_a1", payoutMinor: 4000, feeMinor: 80 });
    await ledger.recordRefund({ jobId: "job_a", refundId: "ref_a1", amountMinor: 2000 });

    expect(await ledger.balance(escrowCode("job_a"))).toBe(10200 - 4080 - 2000);
    expect(await ledger.balance(ACCOUNTS.FEE_REVENUE.code)).toBe(80);
    expect(await ledger.checkInvariants()).toEqual([]);
  });

  it("is idempotent: the same release posted twice moves money once", async () => {
    await makeJob("job_b");
    await ledger.recordFunding({ jobId: "job_b", fundingId: "fund_b", amountMinor: 5000 });
    const first = await ledger.recordRelease({ jobId: "job_b", releaseId: "rel_b1", payoutMinor: 1000, feeMinor: 0 });
    const second = await ledger.recordRelease({ jobId: "job_b", releaseId: "rel_b1", payoutMinor: 1000, feeMinor: 0 });
    expect(second).toEqual({ txnId: first.txnId, duplicate: true });
    expect(await ledger.balance(escrowCode("job_b"))).toBe(4000);
  });

  it("refuses to take escrow negative and rolls back", async () => {
    await makeJob("job_c");
    await ledger.recordFunding({ jobId: "job_c", fundingId: "fund_c", amountMinor: 1000 });
    await expect(ledger.recordRefund({ jobId: "job_c", refundId: "ref_c1", amountMinor: 1001 })).rejects.toThrow(LedgerError);
    expect(await ledger.balance(escrowCode("job_c"))).toBe(1000);
    // The failed attempt must not have consumed its idempotency key.
    await ledger.recordRefund({ jobId: "job_c", refundId: "ref_c1", amountMinor: 1000 });
    expect(await ledger.balance(escrowCode("job_c"))).toBe(0);
  });

  it("rejects unbalanced and malformed lines", () => {
    expect(() => validateLines([{ accountCode: "A", debitMinor: 10 }, { accountCode: "B", creditMinor: 9 }])).toThrow(/Debits/);
    expect(() => validateLines([{ accountCode: "A", debitMinor: 10, creditMinor: 10 }, { accountCode: "B", creditMinor: 0 }])).toThrow();
    expect(() => validateLines([{ accountCode: "A", debitMinor: 1.5 }, { accountCode: "B", creditMinor: 1.5 }])).toThrow();
  });

  it("property: any sequence of releases and refunds keeps every invariant", async () => {
    let n = 0;
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 100, max: 1_000_000 }),
        fc.array(fc.record({ kind: fc.constantFrom("release", "refund"), amount: fc.integer({ min: 1, max: 400_000 }) }), {
          maxLength: 8,
        }),
        async (funded, ops) => {
          const jobId = `job_p${n++}`;
          await makeJob(jobId);
          await ledger.recordFunding({ jobId, fundingId: `fund_${jobId}`, amountMinor: funded });
          let expected = funded;
          for (const [i, op] of ops.entries()) {
            const attempt =
              op.kind === "release"
                ? ledger.recordRelease({ jobId, releaseId: `rel_${jobId}_${i}`, payoutMinor: op.amount, feeMinor: 0 })
                : ledger.recordRefund({ jobId, refundId: `ref_${jobId}_${i}`, amountMinor: op.amount });
            if (op.amount <= expected) {
              await attempt;
              expected -= op.amount;
            } else {
              await expect(attempt).rejects.toThrow(LedgerError);
            }
          }
          expect(await ledger.balance(escrowCode(jobId))).toBe(expected);
        },
      ),
      { numRuns: 25 },
    );
    expect(await ledger.checkInvariants()).toEqual([]);
  });
});
