// pnpm reconcile — compare the ledger and payout records with PayPal; repair missed webhooks; report the rest.
import "./_env";
import { loadConfig } from "@/core/config";
import { createContainer } from "@/core/container";

async function main() {
  const cfg = loadConfig();
  if (cfg.mode === "MOCK") console.log("Note: MOCK mode. The mock PayPal lives in the app process, so run this against LIVE (sandbox) to compare real state.");
  const c = await createContainer(cfg);
  const report = await c.reconciliation.run();
  console.log(JSON.stringify(report, null, 2));
  await c.dbHandle.close();
  process.exit(report.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
