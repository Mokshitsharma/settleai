// Double-entry ledger (Section 11). Every money movement is one balanced transaction, posted at most
// once per idempotency key. ESCROW:<jobId> can never go negative.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "@/core/db/client";
import { ledgerAccounts, ledgerEntries, ledgerTxns } from "@/core/db/schema";
import { newId } from "@/core/ids";
import { assertNonNegativeMinor, type Minor } from "@/core/money";

export type AccountType = "asset" | "liability" | "revenue" | "expense";

export const ACCOUNTS = {
  PAYPAL_BALANCE: { code: "PAYPAL_BALANCE", type: "asset" },
  FEE_REVENUE: { code: "FEE_REVENUE", type: "revenue" },
  PAYPAL_FEES: { code: "PAYPAL_FEES", type: "expense" },
} as const satisfies Record<string, { code: string; type: AccountType }>;

export const escrowCode = (jobId: string) => `ESCROW:${jobId}`;

export interface LedgerLine {
  accountCode: string;
  debitMinor?: Minor;
  creditMinor?: Minor;
}

export interface PostTxnInput {
  idempotencyKey: string; // e.g. "fund:<fundingId>", "release:<releaseId>", "refund:<refundId>"
  kind: "funding" | "release" | "refund" | "adjustment";
  memo?: string;
  refType: string;
  refId: string;
  lines: LedgerLine[];
}

export class LedgerError extends Error {
  constructor(
    readonly code: "UNBALANCED" | "INVALID_LINE" | "ESCROW_NEGATIVE" | "UNKNOWN_ACCOUNT",
    message: string,
  ) {
    super(message);
  }
}

/** Normal balance: assets/expenses are debit-normal, liabilities/revenue are credit-normal. */
function signedBalance(type: AccountType, debit: number, credit: number): number {
  return type === "asset" || type === "expense" ? debit - credit : credit - debit;
}

export function validateLines(lines: LedgerLine[]): void {
  if (lines.length < 2) throw new LedgerError("INVALID_LINE", "A transaction needs at least two lines");
  let debits = 0;
  let credits = 0;
  for (const line of lines) {
    const d = line.debitMinor ?? 0;
    const c = line.creditMinor ?? 0;
    assertNonNegativeMinor(d, "debitMinor");
    assertNonNegativeMinor(c, "creditMinor");
    if ((d === 0) === (c === 0)) {
      throw new LedgerError("INVALID_LINE", `Line for ${line.accountCode} must have exactly one non-zero side`);
    }
    debits += d;
    credits += c;
  }
  if (debits !== credits) throw new LedgerError("UNBALANCED", `Debits ${debits} != credits ${credits}`);
}

export class LedgerService {
  constructor(private readonly db: Db) {}

  async ensureAccount(tx: DbOrTx, code: string, type: AccountType, jobId?: string): Promise<string> {
    await tx
      .insert(ledgerAccounts)
      .values({ id: newId("acct"), code, type, jobId: jobId ?? null })
      .onConflictDoNothing({ target: ledgerAccounts.code });
    const [row] = await tx.select({ id: ledgerAccounts.id }).from(ledgerAccounts).where(eq(ledgerAccounts.code, code));
    return row.id;
  }

  async ensureEscrow(tx: DbOrTx, jobId: string): Promise<string> {
    return this.ensureAccount(tx, escrowCode(jobId), "liability", jobId);
  }

  async ensureSystemAccounts(tx: DbOrTx = this.db): Promise<void> {
    for (const a of Object.values(ACCOUNTS)) await this.ensureAccount(tx, a.code, a.type);
  }

  /**
   * Posts a balanced transaction atomically. Returns the existing txn id (duplicate=true) if the
   * idempotency key was already posted. Pass `tx` to join a caller's database transaction.
   */
  async post(input: PostTxnInput, tx?: DbOrTx): Promise<{ txnId: string; duplicate: boolean }> {
    validateLines(input.lines);
    const run = async (t: DbOrTx) => {
      const codes = [...new Set(input.lines.map((l) => l.accountCode))].sort();
      // Lock touched accounts in a stable order so concurrent postings serialize without deadlocks.
      const accounts = await t
        .select()
        .from(ledgerAccounts)
        .where(inArray(ledgerAccounts.code, codes))
        .orderBy(asc(ledgerAccounts.code))
        .for("update");
      if (accounts.length !== codes.length) {
        const missing = codes.filter((c) => !accounts.some((a) => a.code === c));
        throw new LedgerError("UNKNOWN_ACCOUNT", `Unknown ledger account(s): ${missing.join(", ")}`);
      }

      const txnId = newId("txn");
      const inserted = await t
        .insert(ledgerTxns)
        .values({ id: txnId, idempotencyKey: input.idempotencyKey, kind: input.kind, memo: input.memo })
        .onConflictDoNothing({ target: ledgerTxns.idempotencyKey })
        .returning({ id: ledgerTxns.id });
      if (inserted.length === 0) {
        const [existing] = await t
          .select({ id: ledgerTxns.id })
          .from(ledgerTxns)
          .where(eq(ledgerTxns.idempotencyKey, input.idempotencyKey));
        return { txnId: existing.id, duplicate: true };
      }

      const byCode = new Map(accounts.map((a) => [a.code, a]));
      await t.insert(ledgerEntries).values(
        input.lines.map((l) => ({
          id: newId("le"),
          txnId,
          accountId: byCode.get(l.accountCode)!.id,
          debitMinor: l.debitMinor ?? 0,
          creditMinor: l.creditMinor ?? 0,
          refType: input.refType,
          refId: input.refId,
        })),
      );

      for (const acct of accounts.filter((a) => a.code.startsWith("ESCROW:"))) {
        const balance = await this.balanceById(t, acct.id, acct.type);
        if (balance < 0) throw new LedgerError("ESCROW_NEGATIVE", `${acct.code} would go negative (${balance})`);
      }
      return { txnId, duplicate: false };
    };
    return tx ? run(tx) : this.db.transaction(run);
  }

  // ---- Section 11.1 money flows ------------------------------------------------------------

  /** Funding captured: Dr PAYPAL_BALANCE, Cr ESCROW:job (milestones total + platform fee). */
  async recordFunding(args: { jobId: string; fundingId: string; amountMinor: Minor }, tx?: DbOrTx) {
    const run = async (t: DbOrTx) => {
      await this.ensureSystemAccounts(t);
      await this.ensureEscrow(t, args.jobId);
      return this.post(
        {
          idempotencyKey: `fund:${args.fundingId}`,
          kind: "funding",
          refType: "funding_order",
          refId: args.fundingId,
          lines: [
            { accountCode: ACCOUNTS.PAYPAL_BALANCE.code, debitMinor: args.amountMinor },
            { accountCode: escrowCode(args.jobId), creditMinor: args.amountMinor },
          ],
        },
        t,
      );
    };
    return tx ? run(tx) : this.db.transaction(run);
  }

  /** Milestone released: Dr ESCROW (payout + fee), Cr PAYPAL_BALANCE (payout), Cr FEE_REVENUE (fee). */
  async recordRelease(args: { jobId: string; releaseId: string; payoutMinor: Minor; feeMinor: Minor }, tx?: DbOrTx) {
    const lines: LedgerLine[] = [
      { accountCode: escrowCode(args.jobId), debitMinor: args.payoutMinor + args.feeMinor },
      { accountCode: ACCOUNTS.PAYPAL_BALANCE.code, creditMinor: args.payoutMinor },
    ];
    if (args.feeMinor > 0) lines.push({ accountCode: ACCOUNTS.FEE_REVENUE.code, creditMinor: args.feeMinor });
    return this.post(
      { idempotencyKey: `release:${args.releaseId}`, kind: "release", refType: "release", refId: args.releaseId, lines },
      tx,
    );
  }

  /** Refund to payer: Dr ESCROW, Cr PAYPAL_BALANCE. */
  /** Fee earned without a payout (the non-refundable PayPal costs on a fully refunded milestone): escrow to revenue. */
  async recordFeeRetained(args: { jobId: string; refType: string; refId: string; feeMinor: Minor }, tx?: DbOrTx) {
    if (args.feeMinor <= 0) return null;
    return this.post(
      {
        idempotencyKey: `fee-retained:${args.refType}:${args.refId}`,
        kind: "adjustment",
        memo: "Non-refundable PayPal costs kept",
        refType: args.refType,
        refId: args.refId,
        lines: [
          { accountCode: escrowCode(args.jobId), debitMinor: args.feeMinor },
          { accountCode: ACCOUNTS.FEE_REVENUE.code, creditMinor: args.feeMinor },
        ],
      },
      tx,
    );
  }

  /** PayPal fees posted for these references (funding orders, payouts), net of any fee PayPal gave back. */
  async paypalFeesFor(refIds: string[]): Promise<Minor> {
    if (!refIds.length) return 0;
    const rows = await this.db
      .select({ debit: ledgerEntries.debitMinor, credit: ledgerEntries.creditMinor })
      .from(ledgerEntries)
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
      .where(and(eq(ledgerAccounts.code, ACCOUNTS.PAYPAL_FEES.code), inArray(ledgerEntries.refId, refIds)));
    return rows.reduce((sum, r) => sum + r.debit - r.credit, 0);
  }

  /** What PayPal kept: an expense paid out of the platform's PayPal balance. It never touches escrow. Idempotent per ref. */
  async recordPayPalFee(args: { refType: string; refId: string; feeMinor: Minor }, tx?: DbOrTx) {
    if (args.feeMinor <= 0) return null;
    return this.post(
      {
        idempotencyKey: `ppfee:${args.refType}:${args.refId}`,
        kind: "adjustment",
        memo: "PayPal fee",
        refType: args.refType,
        refId: args.refId,
        lines: [
          { accountCode: ACCOUNTS.PAYPAL_FEES.code, debitMinor: args.feeMinor },
          { accountCode: ACCOUNTS.PAYPAL_BALANCE.code, creditMinor: args.feeMinor },
        ],
      },
      tx,
    );
  }

  /** A fee PayPal gave back on a refund. */
  async recordPayPalFeeReturned(args: { refType: string; refId: string; feeMinor: Minor }, tx?: DbOrTx) {
    if (args.feeMinor <= 0) return null;
    return this.post(
      {
        idempotencyKey: `ppfee-back:${args.refType}:${args.refId}`,
        kind: "adjustment",
        memo: "PayPal fee returned",
        refType: args.refType,
        refId: args.refId,
        lines: [
          { accountCode: ACCOUNTS.PAYPAL_BALANCE.code, debitMinor: args.feeMinor },
          { accountCode: ACCOUNTS.PAYPAL_FEES.code, creditMinor: args.feeMinor },
        ],
      },
      tx,
    );
  }

  async recordRefund(args: { jobId: string; refundId: string; amountMinor: Minor }, tx?: DbOrTx) {
    return this.post(
      {
        idempotencyKey: `refund:${args.refundId}`,
        kind: "refund",
        refType: "refund",
        refId: args.refundId,
        lines: [
          { accountCode: escrowCode(args.jobId), debitMinor: args.amountMinor },
          { accountCode: ACCOUNTS.PAYPAL_BALANCE.code, creditMinor: args.amountMinor },
        ],
      },
      tx,
    );
  }

  // ---- Queries and invariants ----------------------------------------------------------------

  private async balanceById(t: DbOrTx, accountId: string, type: AccountType): Promise<number> {
    const [row] = await t
      .select({
        d: sql<string>`coalesce(sum(${ledgerEntries.debitMinor}), 0)`,
        c: sql<string>`coalesce(sum(${ledgerEntries.creditMinor}), 0)`,
      })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.accountId, accountId));
    return signedBalance(type, Number(row.d), Number(row.c));
  }

  async balance(code: string, t: DbOrTx = this.db): Promise<number> {
    const [acct] = await t.select().from(ledgerAccounts).where(eq(ledgerAccounts.code, code));
    if (!acct) return 0;
    return this.balanceById(t, acct.id, acct.type);
  }

  /** Returns a list of violated invariants (empty = healthy). Used by tests, the admin badge and smoke runs. */
  async checkInvariants(t: DbOrTx = this.db): Promise<string[]> {
    const problems: string[] = [];
    const unbalanced = await t
      .select({
        txnId: ledgerEntries.txnId,
        d: sql<string>`sum(${ledgerEntries.debitMinor})`,
        c: sql<string>`sum(${ledgerEntries.creditMinor})`,
      })
      .from(ledgerEntries)
      .groupBy(ledgerEntries.txnId)
      .having(sql`sum(${ledgerEntries.debitMinor}) <> sum(${ledgerEntries.creditMinor})`);
    for (const u of unbalanced) problems.push(`Transaction ${u.txnId} unbalanced: ${u.d} != ${u.c}`);

    const escrows = await t
      .select()
      .from(ledgerAccounts)
      .where(and(eq(ledgerAccounts.type, "liability"), sql`${ledgerAccounts.code} like 'ESCROW:%'`));
    for (const e of escrows) {
      const bal = await this.balanceById(t, e.id, e.type);
      if (bal < 0) problems.push(`${e.code} is negative (${bal})`);
    }
    return problems;
  }
}
