import { expect, test, type Page } from "@playwright/test";

const SHOTS = ".data/screens";

/** Screenshots are for design review, not assertions: never fail a test because capture failed. */
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

// Journey J1, first half (Phase 1 scope): payer describes a job, the scoping agent drafts it, the payer
// funds it through (mock) PayPal, and a worker accepts it. Verification and payout arrive in Phase 2.
test("payer scopes and funds a job; worker accepts it", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Agents will hire people. Who answers for it?" })).toBeVisible();
  await shot(page, "01-landing");

  await page.getByRole("button", { name: /^Payer/ }).last().click();
  await expect(page.getByRole("heading", { name: "Your jobs" })).toBeVisible();

  await page.getByRole("link", { name: "Describe a new job" }).click();
  await page.getByRole("button", { name: /Deliver 20 cartons/ }).click();
  await page.getByRole("button", { name: "Draft milestones" }).click();
  await expect(page.getByLabel("Milestone 1 amount in dollars")).toHaveValue("40.00");
  await expect(page.getByLabel("Milestone 2 amount in dollars")).toHaveValue("60.00");
  await expect(page.getByText("$100.00").first()).toBeVisible();
  await shot(page, "02-scoped");

  await page.getByRole("button", { name: "Create job" }).click();
  await expect(page.getByText("Ready to fund")).toBeVisible();
  await page.getByRole("button", { name: "Fund with PayPal" }).click();
  await expect(page.getByRole("dialog", { name: "Simulated PayPal checkout" })).toBeVisible();
  await shot(page, "03-checkout");
  await page.getByRole("button", { name: "Pay $102.00" }).click();

  await expect(page.getByText("Funded, open to workers")).toBeVisible();
  await expect(page.getByText("Held in escrow")).toBeVisible();
  await expect(page.getByText(/confirmed by webhook/)).toBeVisible();
  await shot(page, "04-funded");
  const jobUrl = page.url();

  await page.getByRole("group", { name: "View as" }).getByRole("button", { name: "Worker" }).click();
  await expect(page.getByRole("button", { name: "Worker", pressed: true })).toBeVisible();
  await page.goto(jobUrl);
  await page.getByRole("button", { name: "Accept job" }).click();
  await expect(page.getByText("In progress")).toBeVisible();
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
  await shot(page, "05-accepted");
});

test("payer signs an agent mandate with a browser key and revokes it", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^Payer/ }).last().click();
  await page.getByRole("link", { name: "Agent mandates" }).click();
  await expect(page.getByRole("heading", { name: "What your agents may buy" })).toBeVisible();

  await page.getByRole("button", { name: "Preview in plain words" }).click();
  await expect(page.getByText("You are about to sign")).toBeVisible();
  await expect(page.getByText(/Allow ProcureBot to hire delivery services within 25 km of Indore, up to \$150\.00 per job/).first()).toBeVisible();
  await shot(page, "06-mandate-preview");

  await page.getByRole("button", { name: "Sign mandate" }).click();
  await expect(page.getByRole("img", { name: /Signed, hash/ }).first()).toBeVisible();
  await shot(page, "07-mandate-signed");

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Revoke" }).first().click();
  await expect(page.getByText("Revoked", { exact: true }).first()).toBeVisible();
});
