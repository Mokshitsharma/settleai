// node scripts/smoke-live.mjs <base-url> — full money flow through the DEPLOYED site with a real browser: demo logins,
// real AI, PayPal sandbox checkout, webhook, admin approval, payout, receipt. Reads sandbox logins from .env.local.
// Prints ids and memory, never credentials. Writes the downloaded receipt to .data/smoke-receipt.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

process.loadEnvFile(".env.local");
const { SANDBOX_BUYER_EMAIL: email, SANDBOX_BUYER_PASSWORD: password } = process.env;
const base = (process.argv[2] ?? "").replace(/\/$/, "");
if (!base.startsWith("https://")) throw new Error("Usage: node scripts/smoke-live.mjs https://<deployed-host>");

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const api = ctx.request;
const ok = async (res, what) => {
  if (!res.ok()) throw new Error(`${what}: ${res.status()} ${(await res.text()).slice(0, 300)}`);
  return res.json();
};
const post = async (path, data) => ok(await api.post(base + path, data === undefined ? {} : { data }), `POST ${path}`);
const get = async (path) => ok(await api.get(base + path), `GET ${path}`);
const login = (role) => post("/api/auth/demo-login", { role });
const memory = async (label) => {
  const h = await get("/api/health");
  console.log(`  [memory: ${label}] rss ${h.memoryMb.rss} MB, peak ${h.memoryMb.peakRss} MB, boot peak ${h.memoryMb.bootPeakRss} MB`);
  return h;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, fn, seconds = 180) {
  for (const started = Date.now(); Date.now() - started < seconds * 1000; await sleep(2000)) {
    const v = await fn();
    if (v) return v;
  }
  throw new Error(`Timed out waiting for ${what}`);
}

try {
  const h = await memory("start");
  console.log(`mode ${h.mode}, LLM ${h.llm.provider}, db ${h.db.driver}`);
  const unsigned = await api.post(`${base}/api/webhooks/paypal`, { data: { id: "forged", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: {} } });
  console.log(`unsigned webhook: ${unsigned.status()} (want 400)`);

  await login("payer");
  const scope = await (await api.post(`${base}/api/jobs/scope`, { data: { text: "Deliver 20 cartons of tea from Rajwada to Vijay Nagar by 6 pm. Budget $100." } })).text();
  const m = /event: result\ndata: (.*)/.exec(scope);
  if (!m) throw new Error(`Scoping fell back: ${scope.slice(-300)}`);
  const { spec, model } = JSON.parse(m[1]);
  console.log(`scoping on ${model}`);
  const { job } = await post("/api/jobs", { spec });
  const order = await post(`/api/jobs/${job.id}/fund`);
  console.log(`order ${order.orderId}`);

  await page.goto(order.approveUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.locator("#email").fill(email, { timeout: 60_000 });
  if (await page.locator("#btnNext").isVisible()) await page.locator("#btnNext").click();
  await page.locator("#password").fill(password, { timeout: 60_000 });
  await page.locator("#btnLogin").click();
  await page.locator('#payment-submit-btn, [data-testid="submit-button-initial"]').first().click({ timeout: 90_000 });
  await page.waitForURL(`${base}/jobs/${job.id}**`, { timeout: 120_000 });
  const capturedAt = Date.now();
  console.log("buyer approved; back on the job page, which captures automatically");

  const funded = await until("FUNDED", async () => {
    const d = await get(`/api/jobs/${job.id}`);
    return d.job.status === "FUNDED" ? d : null;
  });
  const funding = funded.funding.find((f) => f.status === "CONFIRMED");
  console.log(`funded ${Math.round((Date.now() - capturedAt) / 1000)} s after return; capture ${funding.paypalCaptureId}; confirmedVia ${funding.rawJson?.confirmedVia}`);
  await memory("funded");

  await login("worker");
  await post(`/api/jobs/${job.id}/accept`);
  const m1 = (await get(`/api/jobs/${job.id}`)).milestones[0];
  await post("/api/dev/sample-proof", { milestoneId: m1.id, variant: "genuine" });
  await post(`/api/milestones/${m1.id}/submit`);
  const status = await until("verification", async () => {
    const s = (await get(`/api/jobs/${job.id}`)).milestones[0].status;
    return ["SUBMITTED", "VERIFYING"].includes(s) ? null : s;
  });
  console.log(`verification: milestone ${status}`);
  await memory("real AI verification");

  await login("admin");
  if (status === "NEEDS_REVIEW" || status === "HELD") await post(`/api/milestones/${m1.id}/approve`, { note: "Post-deploy smoke test: approved by the test" });
  const paid = await until("payout", async () => {
    const d = await get(`/api/jobs/${job.id}`);
    return d.milestones[0].status === "RELEASED" ? d : null;
  });
  console.log(`milestone RELEASED; released ${paid.money.releasedMinor}, funded ${paid.money.fundedMinor}`);
  for (const p of ["/admin", "/admin/ledger", "/admin/risk", "/admin/traces"]) {
    const r = await page.goto(base + p, { waitUntil: "domcontentloaded", timeout: 60_000 });
    console.log(`page ${p}: ${r?.status()}`);
  }
  const receipt = await (await api.get(`${base}/api/receipts/${job.id}`)).text();
  mkdirSync(".data", { recursive: true });
  writeFileSync(".data/smoke-receipt.json", receipt);
  const end = await memory("end");
  console.log(`LIVE SMOKE OK: job ${job.id}. Peak ${end.memoryMb.peakRss} MB. Ledger invariants ${end.ledger.invariantsOk}.`);
} catch (err) {
  console.error(`LIVE SMOKE FAILED: ${err.message}`);
  await page.screenshot({ path: ".data/smoke-failure.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
