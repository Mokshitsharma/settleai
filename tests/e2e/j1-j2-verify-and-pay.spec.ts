import { expect, test, type Page } from "@playwright/test";

const SHOTS = ".data/screens";

async function shot(page: Page, name: string) {
  await page.waitForLoadState("networkidle").catch(() => {});
  for (const fullPage of [true, false]) {
    try {
      await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });
      return;
    } catch {
      await page.waitForTimeout(500);
    }
  }
}

async function as(page: Page, role: "Payer" | "Worker" | "Admin") {
  const pressed = page.getByRole("button", { name: role, pressed: true });
  if (await pressed.isVisible().catch(() => false)) return;
  const header = page.getByRole("group", { name: "View as" }).first();
  if (await header.isVisible().catch(() => false)) {
    await header.getByRole("button", { name: role }).click();
    await expect(page.getByRole("button", { name: role, pressed: true })).toBeVisible();
  } else {
    await page.getByRole("button", { name: new RegExp(`^${role}`) }).last().click();
    await expect(page.getByRole("button", { name: role, pressed: true })).toBeVisible();
  }
}

/** Payer scopes and funds the example delivery; worker accepts. Returns the job URL. */
async function fundedAcceptedJob(page: Page): Promise<string> {
  await page.goto("/");
  await as(page, "Payer");
  await page.goto("/new");
  await page.getByRole("button", { name: /Deliver 20 cartons/ }).click();
  await page.getByRole("button", { name: "Draft milestones" }).click();
  await expect(page.getByLabel("Milestone 2 amount in dollars")).toHaveValue("60.00");
  await page.getByRole("button", { name: "Create job" }).click();
  await page.getByRole("button", { name: "Fund with PayPal" }).click();
  await page.getByRole("button", { name: "Pay $102.00" }).click();
  await expect(page.getByText("Funded, open to workers")).toBeVisible();
  const url = page.url();
  await as(page, "Worker");
  await page.goto(url);
  await page.getByRole("button", { name: "Accept job" }).click();
  await expect(page.getByText("In progress")).toBeVisible();
  return url;
}

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
  // Demo challenge window is 15 s (scaled by risk); the payout follows automatically.
  await expect(page.getByText("Paid", { exact: true })).toBeVisible({ timeout: 45_000 });
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
