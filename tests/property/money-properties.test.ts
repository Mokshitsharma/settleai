// fast-check property tests for the money invariants (fixed seeds, so failures reproduce):
//  P1 every accepted ledger transaction has debits == credits, and the whole ledger stays balanced
//  P2 ESCROW:<job> never goes negative over random fund / release / refund sequences
//  P3 a dispute settlement's release + refund == the disputed amount, and the fee split loses no cent
//  P4 end to end: random admin dispute splits through the real services keep every invariant
import fc from "fast-check";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type DbHandle } from "@/core/db/client";
import { jobs, milestones } from "@/core/db/schema";
import { seed } from "@/core/db/seed";
import { ACCOUNTS, escrowCode, LedgerError, LedgerService, validateLines, type LedgerLine } from "@/core/services/ledger";
import { disputeSettlementSplit } from "@/core/services/disputes";
import { splitProportional } from "@/core/money";
import { verifiedMilestone, world, type World } from "../world";

const SEED = 20261027;

describe("P1 validateLines: accepted iff balanced and one-sided", () => {
  const line = fc.record({
    accountCode: fc.constantFrom("A", "B", "C"),
    debitMinor: fc.option(fc.integer({ min: 0, max: 1_000_000 }), { nil: undefined }),
    creditMinor: fc.option(fc.integer({ min: 0, max: 1_000_000 }), { nil: undefined }),
  });
  it("never accepts an unbalanced or malformed transaction", () => {
    fc.assert(
      fc.property(fc.array(line, { minLength: 0, maxLength: 6 }), (lines: LedgerLine[]) => {
        const oneSided = lines.every((l) => ((l.debitMinor ?? 0) === 0) !== ((l.creditMinor ?? 0) === 0));
        const d = lines.reduce((a, l) => a + (l.debitMinor ?? 0), 0);
        const c = lines.reduce((a, l) => a + (l.creditMinor ?? 0), 0);
        const valid = lines.length >= 2 && oneSided && d === c;
        let accepted = true;
        try {
          validateLines(lines);
        } catch (e) {
          expect(e).toBeInstanceOf(LedgerError);
          accepted = false;
        }
        expect(accepted).toBe(valid);
      }),
      { seed: SEED, numRuns: 2000 },
    );
  });
  it("accepts every generated balanced transaction", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 1, maxLength: 5 }), (debits) => {
        const total = debits.reduce((a, b) => a + b, 0);
        const lines: LedgerLine[] = [...debits.map((d) => ({ accountCode: "A", debitMinor: d })), { accountCode: "B", creditMinor: total }];
        expect(() => validateLines(lines)).not.toThrow();
      }),
      { seed: SEED, numRuns: 500 },
    );
  });
});

describe("P1+P2 ledger over random operation sequences (PGlite)", () => {
  let h: DbHandle;
  let ledger: LedgerService;
  let n = 0;
  beforeAll(async () => {
    h = await openTestDb();
    await seed(h.db);
    ledger = new LedgerService(h.db);
    await ledger.ensureSystemAccounts();
  });
  afterAll(() => h.close());

  type Op = { kind: "fund" | "release" | "refund"; amount: number; fee: number };
  const op: fc.Arbitrary<Op> = fc.record({
    kind: fc.constantFrom("fund", "release", "refund") as fc.Arbitrary<Op["kind"]>,
    amount: fc.integer({ min: 1, max: 50_000 }),
    fee: fc.integer({ min: 0, max: 500 }),
  });

  it("debits == credits globally, escrow >= 0, rejected operations leave no trace", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(op, { minLength: 1, maxLength: 12 }), async (ops) => {
        const jobId = `job_prop_${n++}`;
        await h.db.insert(jobs).values({ id: jobId, payerId: "usr_ravi", title: "p", category: "delivery", specJson: {}, totalMinor: 0, feeMinor: 0, createdBy: "test" } as never);
        let model = 0; // expected escrow balance
        for (const [i, o] of ops.entries()) {
          const id = `${jobId}_${i}`;
          try {
            if (o.kind === "fund") await ledger.recordFunding({ jobId, fundingId: id, amountMinor: o.amount });
            else if (o.kind === "release") await ledger.recordRelease({ jobId, releaseId: id, payoutMinor: o.amount, feeMinor: o.fee });
            else await ledger.recordRefund({ jobId, refundId: id, amountMinor: o.amount });
            model += o.kind === "fund" ? o.amount : -(o.amount + (o.kind === "release" ? o.fee : 0));
          } catch (e) {
            // The only acceptable rejections: escrow would go negative, or the escrow account does not exist yet.
            expect(["ESCROW_NEGATIVE", "UNKNOWN_ACCOUNT"]).toContain((e as LedgerError).code);
          }
          expect(model).toBeGreaterThanOrEqual(0);
          expect(await ledger.balance(escrowCode(jobId))).toBe(model);
        }
        // Idempotency: replaying the first operation's key never posts twice.
        if (ops[0].kind === "fund") {
          const again = await ledger.recordFunding({ jobId, fundingId: `${jobId}_0`, amountMinor: ops[0].amount });
          expect(again.duplicate).toBe(true);
          expect(await ledger.balance(escrowCode(jobId))).toBe(model);
        }
      }),
      { seed: SEED, numRuns: 40 },
    );
    const res = (await h.db.execute(sql`select coalesce(sum(debit_minor),0)::bigint d, coalesce(sum(credit_minor),0)::bigint c from ledger_entries`)) as unknown as { rows: { d: string; c: string }[] };
    expect(res.rows[0].d).toBe(res.rows[0].c);
    expect(await ledger.checkInvariants()).toEqual([]);
    const pp = await ledger.balance(ACCOUNTS.PAYPAL_BALANCE.code);
    expect(pp).toBeGreaterThanOrEqual(0);
  });
});

describe("P3 dispute settlement split", () => {
  it("release + refund == disputed; releaseFee + feeRefund == fee; all parts non-negative", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }).chain((disputed) =>
          fc.record({ disputed: fc.constant(disputed), release: fc.integer({ min: 0, max: disputed }), fee: fc.integer({ min: 0, max: 1_000_000 }) }),
        ),
        ({ disputed, release, fee }) => {
          const s = disputeSettlementSplit({ disputedMinor: disputed, releaseToWorkerMinor: release, feeShareMinor: fee });
          expect(release + s.refundToPayerMinor).toBe(disputed);
          expect(s.releaseFeeMinor + s.feeRefundMinor).toBe(fee);
          expect(s.refundToPayerMinor).toBeGreaterThanOrEqual(0);
          expect(s.releaseFeeMinor).toBeGreaterThanOrEqual(0);
          expect(s.feeRefundMinor).toBeGreaterThanOrEqual(0);
          expect(release + s.releaseFeeMinor + s.refundTotalMinor).toBe(disputed + fee);
          for (const v of Object.values(s)) expect(Number.isSafeInteger(v)).toBe(true);
        },
      ),
      { seed: SEED, numRuns: 5000 },
    );
  });
  it("splitProportional never creates or loses a cent", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000 }), fc.array(fc.integer({ min: 0, max: 100_000 }), { minLength: 1, maxLength: 8 }), (total, weights) => {
        fc.pre(weights.some((x) => x > 0));
        const parts = splitProportional(total, weights);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
        expect(parts.every((p) => p >= 0 && Number.isInteger(p))).toBe(true);
      }),
      { seed: SEED, numRuns: 2000 },
    );
  });
});

describe("P4 end to end: random admin dispute splits through the real services", () => {
  const opened: World[] = [];
  afterAll(async () => {
    for (const w of opened) await w.c.dbHandle.close().catch(() => {});
  });
  it("escrow ends at the untouched milestones' value, payouts + refunds == disputed + fee share", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 4000 }), async (release) => {
        const w = await world();
        opened.push(w);
        const { jobId, m1 } = await verifiedMilestone(w);
        const before = await w.c.ledger.balance(escrowCode(jobId));
        const d = await w.c.disputes.open({ milestoneId: m1, userId: "usr_ravi", reason: "Not as described" });
        await w.c.disputes.proposeNow({ disputeId: d.id, userId: "usr_asha" });
        await w.c.disputes.respond({ disputeId: d.id, userId: "usr_ravi", accept: false });
        const disputed = (await w.c.disputes.get(d.id))!.disputedAmountMinor;
        const fee = await w.c.treasury.feeShare(jobId, 1);
        await w.c.disputes.adminResolve({ disputeId: d.id, adminId: "usr_meera", releaseToWorkerMinor: Math.min(release, disputed), faultClass: "SPEC_AMBIGUITY", note: "property" });
        await w.c.deliverMockWebhooks();
        const after = await w.c.ledger.balance(escrowCode(jobId));
        expect(before - after).toBe(disputed + fee);
        expect(after).toBeGreaterThanOrEqual(0);
        const [ms] = await w.c.dbHandle.db.select().from(milestones).where(sql`${milestones.id} = ${m1}`);
        expect(ms.status).toBe("RESOLVED");
        expect(await w.c.ledger.checkInvariants()).toEqual([]);
        await w.c.dbHandle.close();
        opened.splice(opened.indexOf(w), 1);
      }),
      { seed: SEED, numRuns: 6, examples: [[0], [4000]] },
    );
  }, 300_000);
});
