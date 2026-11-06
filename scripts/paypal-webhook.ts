// pnpm paypal:webhook <https://public-host> — registers SettleAI's PayPal sandbox webhook (reuses one that already
// points at the URL) and stores its id as PAYPAL_WEBHOOK_ID in .env.local. Sandbox only. Prints no credentials.
import "./_env";
import { readFileSync, writeFileSync } from "node:fs";

const EVENTS = [
  "CHECKOUT.ORDER.APPROVED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.DECLINED",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.CAPTURE.REVERSED",
  "PAYMENT.PAYOUTSBATCH.SUCCESS",
  "PAYMENT.PAYOUTSBATCH.DENIED",
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
  "PAYMENT.PAYOUTS-ITEM.FAILED",
  "PAYMENT.PAYOUTS-ITEM.BLOCKED",
  "PAYMENT.PAYOUTS-ITEM.RETURNED",
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
];

async function main() {
  const host = process.argv[2]?.replace(/\/$/, "");
  if (!host?.startsWith("https://")) throw new Error("Usage: pnpm paypal:webhook https://<public-host> (PayPal requires HTTPS)");
  const { PAYPAL_CLIENT_ID: id, PAYPAL_CLIENT_SECRET: secret, PAYPAL_ENV = "sandbox" } = process.env;
  if (PAYPAL_ENV !== "sandbox") throw new Error("Sandbox only");
  const base = "https://api-m.sandbox.paypal.com";
  const auth = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!auth.ok) throw new Error(`OAuth failed: HTTP ${auth.status}`);
  const { access_token: token, app_id: appId } = (await auth.json()) as { access_token: string; app_id: string };
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const url = `${host}/api/webhooks/paypal`;

  const list = (await (await fetch(`${base}/v1/notifications/webhooks`, { headers })).json()) as { webhooks?: { id: string; url: string }[] };
  let webhookId = list.webhooks?.find((w) => w.url === url)?.id;
  if (!webhookId) {
    const res = await fetch(`${base}/v1/notifications/webhooks`, { method: "POST", headers, body: JSON.stringify({ url, event_types: EVENTS.map((name) => ({ name })) }) });
    const body = await res.text();
    if (!res.ok) throw new Error(`Webhook registration failed: HTTP ${res.status} ${body}`);
    webhookId = (JSON.parse(body) as { id: string }).id;
  }
  const env = readFileSync(".env.local", "utf8");
  writeFileSync(".env.local", /^PAYPAL_WEBHOOK_ID=.*$/m.test(env) ? env.replace(/^PAYPAL_WEBHOOK_ID=.*$/m, `PAYPAL_WEBHOOK_ID=${webhookId}`) : `${env.trimEnd()}\nPAYPAL_WEBHOOK_ID=${webhookId}\n`);
  console.log(`App ${appId}: webhook ${webhookId} -> ${url}. Stored in .env.local; set the same PAYPAL_WEBHOOK_ID on Render.`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
