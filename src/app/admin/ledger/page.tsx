import { ACCOUNTS } from "@/core/services/ledger";
import type { Metadata } from "next";
import { getContainer } from "@/core/container";
import { formatMinor } from "@/core/money";
import { DataGrid, type ColumnSpec } from "@/components/data-grid";
import { Pill } from "@/components/ui";

export const metadata: Metadata = { title: "Ledger" };
export const dynamic = "force-dynamic";

const COLUMNS: ColumnSpec[] = [
  { field: "at", header: "When", kind: "datetime", width: 170 },
  { field: "kind", header: "Movement", kind: "status", width: 120, tones: { funding: "info", release: "good", refund: "warn" } },
  { field: "account", header: "Account", width: 140 },
  { field: "debitMinor", header: "Debit", kind: "money", width: 110 },
  { field: "creditMinor", header: "Credit", kind: "money", width: 110 },
  { field: "job", header: "Job", kind: "code", flex: 1 },
  { field: "txn", header: "Transaction", kind: "code", flex: 1 },
  { field: "ref", header: "Reference", kind: "code", flex: 1 },
];

export default async function LedgerPage() {
  const c = await getContainer();
  const [rows, problems, recon] = await Promise.all([c.analytics.ledgerGrid(), c.ledger.checkInvariants(), c.reconciliation.run()]);
  const debits = rows.reduce((a, r) => a + (r.debitMinor ?? 0), 0);
  const credits = rows.reduce((a, r) => a + (r.creditMinor ?? 0), 0);
  const feeRevenue = await c.ledger.balance(ACCOUNTS.FEE_REVENUE.code);
  const paypalFees = await c.ledger.balance(ACCOUNTS.PAYPAL_FEES.code);
  return (
    <main>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Ledger</h1>
          <p className="mt-1 max-w-[70ch] text-ink-soft">Double-entry record of every cent: funding into escrow, payouts, fees and refunds. Every transaction balances.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Pill tone={problems.length ? "bad" : "good"}>{problems.length ? `${problems.length} invariant problems` : "All ledger invariants hold"}</Pill>
          <Pill tone={recon.ok ? "good" : "bad"}>{recon.ok ? `Matches PayPal${recon.unverifiable ? ` (${recon.unverifiable} older mock payouts not checkable)` : ""}` : `${recon.mismatches.length} mismatches with PayPal`}</Pill>
        </div>
      </div>
      <p className="num mt-3 text-sm text-ink-soft">
        Debits {formatMinor(debits)}, credits {formatMinor(credits)}
      </p>
      <p className="num mt-1 text-sm text-ink-soft">
        Fees earned {formatMinor(feeRevenue)}, PayPal charged {formatMinor(paypalFees)}, SettleAI keeps {formatMinor(feeRevenue - paypalFees)}
      </p>
      {problems.length ? (
        <ul className="mt-2 list-disc pl-5 text-sm text-deny">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-4">
        <DataGrid rows={rows} columns={COLUMNS} exportName="settleai-ledger" height={600} />
      </div>
    </main>
  );
}
