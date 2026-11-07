import { expect, test } from "@playwright/test";
import { as, fundedAcceptedJob, shot, submitSample } from "./helpers";

test("J3: payer disputes in the challenge window; arbiter splits 70/30 with a liability finding; PayPal pays and refunds", async ({ page }) => {
  const url = await fundedAcceptedJob(page);
  await submitSample(page, url, "Photo at the right place");
  await expect(page.getByText("Approved by policy")).toBeVisible();

  await as(page, "Payer");
  await page.goto(url);
  await page.getByRole("button", { name: "Dispute this milestone" }).click();
  await page.getByLabel("What went wrong?").fill("Some cartons arrived crushed");
  await page.getByRole("button", { name: "Open dispute and freeze payout" }).click();
  await expect(page.getByRole("region", { name: "Dispute" })).toBeVisible();
  await page.getByLabel("Your statement").fill("6 of 20 cartons arrived crushed and the tea was spilled");
  await page.getByRole("button", { name: "Add evidence" }).click();
  await expect(page.getByText("6 of 20 cartons arrived crushed and the tea was spilled")).toBeVisible();
  await page.getByRole("button", { name: "Ask the arbiter now" }).click();

  const dispute = page.getByRole("region", { name: "Dispute" });
  await expect(dispute.getByText("Arbiter proposal")).toBeVisible();
  await expect(dispute.getByText("$28.00")).toBeVisible();
  await expect(dispute.getByText("Work partly done")).toBeVisible();
  await expect(dispute.getByText("Payment Mandate, milestone 1: $40.00 settles only when")).toBeVisible();
  await shot(page, "20-dispute-proposal");
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(dispute.getByText(/Payer: accept/)).toBeVisible();

  await as(page, "Worker");
  await page.goto(url);
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.getByText(/Settled through PayPal: \$28.00 paid to the worker, \$12.00 refunded to the payer/)).toBeVisible();
  await expect(page.getByText("Resolved", { exact: true })).toBeVisible();
  await shot(page, "21-dispute-settled");
});

test("J7: the receipt verifies in the browser, and a one-byte change fails with a pointer", async ({ page, request }) => {
  const url = await fundedAcceptedJob(page);
  const jobId = url.split("/").pop()!;

  await page.goto(`/receipt/${jobId}`);
  await expect(page.getByRole("heading", { name: /Deliver 20 cartons/ })).toBeVisible();
  await page.getByRole("button", { name: "Verify in my browser" }).click();
  await expect(page.getByText("Receipt verified")).toBeVisible();
  await shot(page, "22-receipt-verified");

  // Change one byte: the funded amount 10200 becomes 10300 inside the signed chain.
  const original = await (await request.get(`/api/receipts/${jobId}`)).text();
  const tampered = original.replace('"amountMinor": 10200', '"amountMinor": 10300');
  expect(tampered).not.toBe(original);
  expect(tampered.length).toBe(original.length);

  await page.goto("/verify");
  await page.locator('input[type="file"]').setInputFiles({ name: "tampered-receipt.json", mimeType: "application/json", buffer: Buffer.from(tampered) });
  await expect(page.getByText("Receipt failed verification")).toBeVisible();
  // The pointer names where the change was found (the first 10200 sits in the signed Payment Mandate).
  await expect(page.getByText(/^at (mandates|attestations)/).first()).toBeVisible();
  await shot(page, "23-receipt-tampered");

  await page.locator('input[type="file"]').setInputFiles({ name: "receipt.json", mimeType: "application/json", buffer: Buffer.from(original) });
  await expect(page.getByText("Receipt verified")).toBeVisible();
});

test("the showcase receipt is permanent: its page and download verify, with no job in the database", async ({ page, request }) => {
  await page.goto("/receipt/showcase");
  await expect(page.getByText("The permanent showcase")).toBeVisible();
  await page.getByRole("button", { name: /verify/i }).first().click();
  await expect(page.getByText("Receipt verified")).toBeVisible();
  const res = await request.get("/api/receipts/showcase?download");
  expect(res.ok()).toBe(true);
  expect(res.headers()["content-disposition"]).toContain("settleai-receipt-showcase.json");
});

test("a receipt that is no longer on the server explains the reset and points to the showcase", async ({ page }) => {
  await page.goto("/receipt/job_that_no_longer_exists");
  await expect(page.getByRole("heading", { name: "This receipt is no longer on the demo server" })).toBeVisible();
  await expect(page.getByRole("link", { name: "see the permanent showcase receipt" })).toBeVisible();
});
