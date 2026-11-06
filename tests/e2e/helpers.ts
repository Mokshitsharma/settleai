import { expect, type Page } from "@playwright/test";

export const SHOTS = ".data/screens";

/** Screenshots are for design review, not assertions: never fail a test because capture failed. */
export async function shot(page: Page, name: string) {
  await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => {}); // the live event stream may never idle
  for (const fullPage of [true, false]) {
    try {
      await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });
      return;
    } catch {
      await page.waitForTimeout(500);
    }
  }
}

export async function as(page: Page, role: "Payer" | "Worker" | "Admin") {
  if (await page.getByRole("button", { name: role, pressed: true }).isVisible().catch(() => false)) return;
  const header = page.getByRole("group", { name: "View as" }).first();
  if (await header.getByRole("button", { name: role, exact: true }).isVisible().catch(() => false)) {
    await header.getByRole("button", { name: role, exact: true }).click();
  } else {
    await page.getByRole("button", { name: new RegExp(`^${role}`) }).last().click();
  }
  await expect(page.getByRole("button", { name: role, pressed: true })).toBeVisible();
}

/** Payer scopes and funds the example delivery; worker accepts. Returns the job URL. */
export async function fundedAcceptedJob(page: Page): Promise<string> {
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

/** Worker submits a demo photo for milestone 1 and returns to the job page. */
export async function submitSample(page: Page, url: string, sample: string) {
  await page.getByRole("link", { name: "Submit proof" }).click();
  await page.getByText("No phone at the job site? Use a demo photo").click();
  await page.getByRole("button", { name: sample }).click();
  await expect(page.getByRole("img", { name: "Your proof photo" })).toBeVisible();
  await page.getByRole("button", { name: "Submit for verification" }).click();
  await expect(page).toHaveURL(url);
}
