// node scripts/record-demo.mjs <live-url> — records the demo against the LIVE site at 1920x1080 and takes the Devpost
// screenshots on the way. Real PayPal sandbox, real models, real waits (the edit trims them). Writes
// .data/video/raw.webm, .data/video/marks.json and docs/devpost/*.png. Sandbox logins come from .env.local.
import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

process.loadEnvFile(".env.local");
const base = (process.argv[2] ?? "").replace(/\/$/, "");
if (!base.startsWith("https://")) throw new Error("Usage: node scripts/record-demo.mjs https://<live-host>");
const { SANDBOX_BUYER_EMAIL: buyerEmail, SANDBOX_BUYER_PASSWORD: buyerPassword } = process.env;
const OUT = ".data/video";
const PART2 = process.argv.includes("--part2"); // second job: reused photo, risk queue, receipts
mkdirSync(OUT, { recursive: true });
mkdirSync("docs/devpost", { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 }, deviceScaleFactor: 1.25, recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } } });
const page = await ctx.newPage();
const started = Date.now();
const marks = [];
const mark = (name) => {
  marks.push({ name, t: (Date.now() - started) / 1000 });
  console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s] ${name}`);
};
const shot = (name) => page.screenshot({ path: `docs/devpost/${name}.png` });
// Devpost still cropped to the region from the top of one element to the bottom of another (page coordinates).
const shotBetween = async (name, top, bottom, pad = 24) => {
  const a = await top.first().boundingBox();
  const b = await bottom.first().boundingBox();
  const scrollY = await page.evaluate(() => window.scrollY);
  if (!a || !b) return shot(name);
  const x = Math.max(0, Math.min(a.x, b.x) - pad);
  const y = Math.max(0, a.y + scrollY - pad);
  const width = Math.max(a.x + a.width, b.x + b.width) - x + pad;
  const height = b.y + b.height + scrollY - y + pad;
  return page.screenshot({ path: `docs/devpost/${name}.png`, fullPage: true, clip: { x, y, width, height } });
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const as = async (role) => {
  await page.request.post(`${base}/api/auth/demo-login`, { data: { role: role.toLowerCase() } });
};
const visible = (locator, timeout = 120_000) => locator.first().waitFor({ state: "visible", timeout });

try {
  // Warm the server first so the recording never shows a cold start.
  await page.request.get(`${base}/api/health`, { timeout: 180_000 });

  if (!PART2) {
  // Scene: landing
  await page.goto(base, { waitUntil: "networkidle" });
  mark("landing");
  await sleep(3000);
  await shot("1-landing");

  // Scene: mandate, then Moment 1 (denied before money moves)
  await as("Payer");
  await page.goto(`${base}/mandates`, { waitUntil: "networkidle" });
  mark("mandates");
  await sleep(3000);
  await page.getByRole("button", { name: "Out of scope" }).click();
  await sleep(800);
  mark("agent-out-of-scope");
  await page.getByRole("button", { name: "Send as agent" }).click();
  await visible(page.getByText("Denied before any money moved"));
  await page.getByText("Denied before any money moved").scrollIntoViewIfNeeded();
  mark("denied");
  await sleep(3500);
  await shotBetween("2-denied-before-money-moves", page.getByRole("heading", { name: "Send a request as the agent" }), page.getByRole("status").filter({ hasText: "Denied before any money moved" }));

  // Scene: agent hires within its mandate (real scoping), payer funds on the PayPal sandbox
  await page.getByRole("button", { name: "In scope" }).click();
  await page.getByLabel("The agent asks to hire for").fill("Deliver 2 cartons of tea from Rajwada to Vijay Nagar in Indore by 6 pm today");
  await page.getByLabel("Budget, USD").fill("100");
  mark("agent-in-scope");
  await page.getByRole("button", { name: "Send as agent" }).click();
  await visible(page.getByRole("link", { name: "Review and fund the job the agent created" }));
  mark("agent-allowed");
  await sleep(2500);
  await page.getByRole("link", { name: "Review and fund the job the agent created" }).click();
  await page.waitForURL(/\/jobs\//);
  const jobUrl = page.url().split("?")[0];
  mark("job-created");
  await sleep(2500);
  await page.getByRole("button", { name: "Fund with PayPal" }).click();
  await visible(page.getByRole("link", { name: "Approve on PayPal sandbox" }));
  mark("fund-clicked");
  await sleep(1500);
  await page.getByRole("link", { name: "Approve on PayPal sandbox" }).click();
  await page.locator("#email").fill(buyerEmail, { timeout: 90_000 });
  mark("paypal-checkout");
  if (await page.locator("#btnNext").isVisible()) await page.locator("#btnNext").click();
  await page.locator("#password").fill(buyerPassword, { timeout: 60_000 });
  await page.locator("#btnLogin").click();
  await page.locator('#payment-submit-btn, [data-testid="submit-button-initial"]').first().waitFor({ timeout: 90_000 });
  mark("paypal-review");
  await sleep(2000);
  await page.locator('#payment-submit-btn, [data-testid="submit-button-initial"]').first().click();
  await page.waitForURL(`${jobUrl}**`, { timeout: 120_000 });
  mark("paypal-returned");
  await visible(page.getByText("Funded, open to workers"), 180_000);
  mark("funded");
  await sleep(3000);

  // Scene: worker accepts, then proves pickup after a real wait (under a minute is flagged TOO_FAST)
  await as("Worker");
  await page.goto(jobUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Accept job" }).click();
  await visible(page.getByText("In progress"));
  mark("accepted");
  await sleep(130_000);
  await page.getByRole("link", { name: "Submit proof" }).first().click();
  await page.getByText("No phone at the job site? Use a demo photo").click();
  await page.getByRole("button", { name: "Photo at the right place" }).click();
  await visible(page.getByRole("img", { name: "Your proof photo" }));
  mark("proof-photo");
  await sleep(2500);
  await page.getByRole("button", { name: "Submit for verification" }).click();
  await page.waitForURL(`${jobUrl}**`);
  mark("submitted");
  await visible(page.getByText(/Approved by policy|Needs a person|Held/), 180_000);
  const decision = (await page.getByRole("region", { name: "Decision" }).first().innerText()).split("\n").slice(0, 3).join(" ");
  mark(`decision: ${decision.slice(0, 120)}`);
  if (!/Approved by policy/.test(decision)) throw new Error(`STOP: milestone 1 went to review or hold: ${decision}`);
  await page.getByRole("region", { name: "Decision" }).first().scrollIntoViewIfNeeded();
  await shot("3-decision-card-real-model");

  // Scene: Moment 3, a dispute inside the challenge window, then the Arbiter's liability finding
  await as("Payer");
  await page.goto(jobUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Dispute this milestone" }).click();
  await page.getByLabel("What went wrong?").fill("One carton arrived crushed and torn open");
  await page.getByRole("button", { name: "Open dispute and freeze payout" }).click();
  await visible(page.getByRole("region", { name: "Dispute" }));
  mark("dispute-opened");
  await page.getByLabel("Your statement").fill("One of the 2 cartons arrived crushed and torn open; photo attached.");
  await page.getByRole("button", { name: "Add evidence" }).click();
  await sleep(1500);
  await page.getByRole("button", { name: "Add demo photo of the damage" }).click();
  await sleep(2500);
  mark("evidence-added");
  await page.getByRole("button", { name: "Ask the arbiter now" }).click();
  await visible(page.getByText("Liability finding"), 240_000);
  await page.getByText("Liability finding").scrollIntoViewIfNeeded();
  mark("liability-finding");
  await sleep(5000);
  await shotBetween("4-liability-finding-cites-mandate", page.getByText("Arbiter proposal", { exact: true }), page.getByText(/Settled through PayPal|Payer: /).last());
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await sleep(1500);
  await as("Worker");
  await page.goto(jobUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await visible(page.getByText(/Settled through PayPal/), 240_000);
  await page.getByText(/Settled through PayPal/).scrollIntoViewIfNeeded();
  mark("settled");
  await sleep(4000);

  }

  // Scene: Moment 2, a second job; the photo from the first job is reused, held, and lands in the risk queue
  await as("Payer");
  await page.goto(`${base}/mandates`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "In scope" }).click();
  await page.getByLabel("The agent asks to hire for").fill("Deliver 2 cartons of tea from Rajwada to Palasia in Indore by 7 pm today");
  await page.getByLabel("Budget, USD").fill("100");
  await page.getByRole("button", { name: "Send as agent" }).click();
  await visible(page.getByRole("link", { name: "Review and fund the job the agent created" }));
  await page.getByRole("link", { name: "Review and fund the job the agent created" }).click();
  await page.waitForURL(/\/jobs\//);
  const job2 = page.url().split("?")[0];
  await page.getByRole("button", { name: "Fund with PayPal" }).click();
  await page.getByRole("link", { name: "Approve on PayPal sandbox" }).click();
  await page.locator("#email").fill(buyerEmail, { timeout: 90_000 });
  if (await page.locator("#btnNext").isVisible()) await page.locator("#btnNext").click();
  await page.locator("#password").fill(buyerPassword, { timeout: 60_000 });
  await page.locator("#btnLogin").click();
  await page.locator('#payment-submit-btn, [data-testid="submit-button-initial"]').first().click({ timeout: 90_000 });
  await page.waitForURL(`${job2}**`, { timeout: 120_000 });
  await visible(page.getByText("Funded, open to workers"), 180_000);
  mark("job2-funded");
  await as("Worker");
  await page.goto(job2, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Accept job" }).click();
  await visible(page.getByText("In progress"));
  await page.getByRole("link", { name: "Submit proof" }).first().click();
  await page.getByText("No phone at the job site? Use a demo photo").click();
  await page.getByRole("button", { name: "Photo reused from another job" }).click();
  await visible(page.getByRole("img", { name: "Your proof photo" }));
  mark("reused-photo");
  await page.getByRole("button", { name: "Submit for verification" }).click();
  await visible(page.getByText(/already submitted for another job/), 180_000);
  await page.getByText(/already submitted for another job/).first().scrollIntoViewIfNeeded();
  mark("held");
  await sleep(4000);
  await as("Admin");
  await page.goto(`${base}/admin/risk`, { waitUntil: "networkidle" });
  mark("risk-queue");
  await sleep(4000);
  await shot("5-ag-grid-risk-queue");

  // Scene: Moment 4, the permanent showcase receipt verifies, and a one-byte change fails
  await page.goto(`${base}/receipt/showcase`, { waitUntil: "networkidle" });
  mark("showcase");
  await sleep(2000);
  await page.getByRole("button", { name: "Verify in my browser" }).click();
  await visible(page.getByText("Receipt verified"));
  await page.getByText("Receipt verified").scrollIntoViewIfNeeded();
  mark("showcase-verified");
  await sleep(4000);
  const raw = await page.request.get(`${base}/api/receipts/showcase`).then((r) => r.text());
  const at = raw.indexOf('"amountMinor": ') + '"amountMinor": '.length;
  const tampered = raw.slice(0, at) + (raw[at] === "9" ? "8" : String(Number(raw[at]) + 1)) + raw.slice(at + 1);
  writeFileSync(`${OUT}/tampered-receipt.json`, tampered);
  await page.goto(`${base}/verify`, { waitUntil: "networkidle" });
  mark("verify-page");
  await sleep(1500);
  await page.locator('input[type="file"]').setInputFiles(`${OUT}/tampered-receipt.json`);
  await visible(page.getByText("Receipt failed verification"));
  mark("tamper-failed");
  await sleep(5000);
  mark("end");
} catch (err) {
  mark(`FAILED: ${err.message.split("\n")[0]}`);
  await page.screenshot({ path: `${OUT}/failure.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  const video = page.video();
  await ctx.close();
  await browser.close();
  if (video) renameSync(await video.path(), `${OUT}/raw.webm`);
  writeFileSync(`${OUT}/marks.json`, JSON.stringify(marks, null, 2));
}
void copyFileSync;
void readFileSync;
