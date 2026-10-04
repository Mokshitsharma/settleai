import { expect, test } from "@playwright/test";
import { as, fundedAcceptedJob, shot } from "./helpers";

test("J1: proof is verified, waits out the challenge window, and PayPal pays the worker", async ({ page }) => {
  const url = await fundedAcceptedJob(page);
  await page.getByRole("link", { name: "Submit proof" }).click();
  await expect(page.getByRole("heading", { name: /Milestone 1: Pickup/ })).toBeVisible();
  await page.getByText("No phone at the job site? Use a demo photo").click();
  await page.getByRole("button", { name: "Photo at the right place" }).click();
  await expect(page.getByRole("img", { name: "Your proof photo" })).toBeVisible();
  await shot(page, "10-worker-submit");
  await page.getByRole("button", { name: "Submit for verification" }).click();

  await expect(page).toHaveURL(url);
  await expect(page.getByText("Approved by policy")).toBeVisible();
  await expect(page.getByRole("region", { name: "Decision" }).getByText(/Released automatically: 2 of 2 criteria verified/)).toBeVisible();
  await shot(page, "11-decision-auto-release");
  // The e2e challenge window is 30 s (scaled by risk); the payout follows automatically.
  await expect(page.getByText("Paid", { exact: true })).toBeVisible({ timeout: 70_000 });
  await expect(page.getByRole("complementary").getByText(/PayPal payout succeeded: \$40.00 to the worker/)).toBeVisible();
  await shot(page, "12-paid");
});

test("J2: a reused photo is held, and the admin rejects it", async ({ page }) => {
  const url = await fundedAcceptedJob(page);
  await page.getByRole("link", { name: "Submit proof" }).click();
  await page.getByText("No phone at the job site? Use a demo photo").click();
  await page.getByRole("button", { name: "Photo reused from another job" }).click();
  await expect(page.getByRole("img", { name: "Your proof photo" })).toBeVisible();
  await page.getByRole("button", { name: "Submit for verification" }).click();

  await expect(page).toHaveURL(url);
  await expect(page.getByText("Held", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/already submitted for another job/).first()).toBeVisible();
  await shot(page, "13-held-duplicate");

  await as(page, "Admin");
  await page.goto(url);
  await page.getByLabel("Your decision").fill("Same photo as an earlier delivery");
  await page.getByRole("button", { name: "Reject" }).click();
  await expect(page.getByText("Rejected", { exact: true })).toBeVisible();
  await expect(page.getByRole("complementary").getByText(/Fraud confirmed; worker trust is now/)).toBeVisible();
  await shot(page, "14-admin-rejected");
});

test("Agent request outside the mandate is denied with reason codes", async ({ page }) => {
  await page.goto("/");
  await as(page, "Payer");
  await page.goto("/mandates");
  await page.getByRole("button", { name: "Out of scope" }).click();
  await page.getByRole("button", { name: "Send as agent" }).click();
  await expect(page.getByText("Denied before any money moved")).toBeVisible();
  await expect(page.getByText("MANDATE_SCOPE_VIOLATION")).toBeVisible();
  await expect(page.getByText("MANDATE_CAP_EXCEEDED")).toBeVisible();
  await shot(page, "15-denial-card");

  await page.getByRole("button", { name: "In scope" }).click();
  await page.getByRole("button", { name: "Send as agent" }).click();
  await expect(page.getByText("Allowed by the mandate")).toBeVisible();
  await page.getByRole("link", { name: "Review and fund the job the agent created" }).click();
  await expect(page.getByText("Ready to fund")).toBeVisible();
});
