// node scripts/smoke-http.mjs <base-url> — a demo flow over real HTTP against a running server, including AI calls and a
// large photo upload. Prints each step and the server's memory. In LIVE mode it stops after creating the PayPal order,
// because a buyer has to approve it. Uses only demo logins, so it is safe to point at the deployed demo.
import sharp from "sharp";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
let cookie = "";

async function call(path, opts = {}) {
  const headers = { cookie, ...(opts.body && !(opts.body instanceof FormData) ? { "content-type": "application/json" } : {}) };
  const res = await fetch(base + path, { ...opts, headers, redirect: "manual" });
  const set = res.headers.getSetCookie?.()[0];
  if (set) cookie = set.split(";")[0];
  return res;
}
async function json(path, opts) {
  const res = await call(path, opts);
  const text = await res.text();
  if (!res.ok) throw new Error(`${opts?.method ?? "GET"} ${path}: ${res.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}
const post = (path, body) => json(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const login = (role) => post("/api/auth/demo-login", { role });
async function memory(label) {
  const h = await json("/api/health");
  console.log(`  [memory after ${label}] rss ${h.memoryMb?.rss} MB, peak ${h.memoryMb?.peakRss} MB, boot peak ${h.memoryMb?.bootPeakRss} MB`);
  return h;
}

/** A photo-sized image with real detail, so decoding and re-encoding cost what a phone photo costs. */
async function largePhoto() {
  const width = 4000;
  const height = 3000;
  const noise = { create: { width, height, channels: 3, background: "#8a6d4b", noise: { type: "gaussian", mean: 128, sigma: 40 } } };
  return sharp(noise).jpeg({ quality: 70 }).toBuffer();
}

async function main() {
  const health = await memory("start");
  console.log(`mode ${health.mode}, LLM ${health.llm.provider} ${health.llm.model}, db ${health.db.driver}`);
  if (health.llm.provider === "stub") console.log("  WARNING: the offline stub is in use; no real AI calls in this run");

  await call("/");
  await login("payer");
  const scope = await (await call("/api/jobs/scope", { method: "POST", body: JSON.stringify({ text: "Deliver 20 cartons of tea from Rajwada to Vijay Nagar by 6 pm. Budget $100." }) })).text();
  const result = /event: result\ndata: (.*)/.exec(scope);
  if (!result) throw new Error(`Scoping fell back: ${scope.slice(-300)}`);
  const { spec, model } = JSON.parse(result[1]);
  console.log(`scoping ok on ${model}`);
  await memory("scoping");

  const { job } = await post("/api/jobs", { spec });
  const order = await post(`/api/jobs/${job.id}/fund`);
  console.log(`order ${order.orderId} (${order.mode})`);
  if (order.mode !== "MOCK") {
    console.log("LIVE mode: order created on PayPal; buyer approval is needed to go further.");
    await memory("order");
    return;
  }
  await post("/api/dev/mock-paypal/approve", { orderId: order.orderId });
  await post(`/api/jobs/${job.id}/fund/capture`, { orderId: order.orderId });
  await login("worker");
  await post(`/api/jobs/${job.id}/accept`);
  const detail = await json(`/api/jobs/${job.id}`);
  const m1 = detail.milestones[0];

  const form = new FormData();
  form.append("photo", new File([await largePhoto()], "photo.jpg", { type: "image/jpeg" }));
  console.log(`uploaded photo: ${JSON.stringify(await json(`/api/milestones/${m1.id}/proofs`, { method: "POST", body: form }))}`);
  await memory("12 MP photo upload");
  await post("/api/dev/sample-proof", { milestoneId: m1.id, variant: "genuine" });
  await post(`/api/milestones/${m1.id}/submit`);

  let status = "";
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    status = (await json(`/api/jobs/${job.id}`)).milestones[0].status;
    if (!["SUBMITTED", "VERIFYING"].includes(status)) break;
  }
  console.log(`verification finished: milestone ${status}`);
  await memory("verification");

  await login("admin");
  for (const page of ["/admin", "/admin/risk", "/admin/ledger", "/admin/mandates", "/admin/traces", "/admin/eval", `/jobs/${job.id}`, "/verify"]) {
    const res = await call(page);
    await res.text();
    console.log(`page ${page}: ${res.status}`);
  }
  await memory("admin pages");
  const final = await memory("end");
  console.log(`SMOKE OK. Peak RSS ${final.memoryMb.peakRss} MB, boot peak ${final.memoryMb.bootPeakRss} MB.`);
}

main().catch((err) => {
  console.error(`SMOKE FAILED: ${err.message}`);
  process.exit(1);
});
