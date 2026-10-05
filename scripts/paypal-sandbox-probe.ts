// pnpm paypal:probe — checks the live PayPal adapter against the sandbox with the credentials in .env.local:
// OAuth, Orders v2 create (prints the approve link), and a $1.00 Payouts batch to a sandbox email.
// Sandbox only; refuses to run against live PayPal.
import "./_env";
import { PayPalAdapter } from "@/core/adapters/paypal/live";

const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_ENV = "sandbox" } = process.env;
if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) throw new Error("Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env.local");
if (PAYPAL_ENV !== "sandbox") throw new Error("The probe only runs against the sandbox");

const receiver = process.argv[2] ?? "settleai-probe-worker@personal.example.com";
const pp = new PayPalAdapter({ clientId: PAYPAL_CLIENT_ID, clientSecret: PAYPAL_CLIENT_SECRET, env: "sandbox" });
const run = `probe_${Date.now()}`;

async function main(): Promise<void> {
  const order = await pp.createOrder({
    requestId: `fund_${run}_1`,
    amountMinor: 100,
    currency: "USD",
    customId: run,
    invoiceId: run,
    description: "SettleAI sandbox probe",
  });
  console.log(`✓ order ${order.orderId} ${order.status}\n  approve: ${order.approveUrl}`);

  try {
    const payout = await pp.createPayout({
      requestId: `rel_${run}`,
      senderBatchId: run,
      senderItemId: run,
      receiverEmail: receiver,
      amountMinor: 100,
      currency: "USD",
      note: "SettleAI sandbox probe",
    });
    console.log(`✓ payout batch ${payout.batchId} ${payout.status} -> ${receiver}`);
  } catch (err) {
    console.log(`✘ payout: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
