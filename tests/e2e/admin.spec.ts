import { expect, test } from "@playwright/test";
import { as, shot } from "./helpers";

test("admin console: overview with history, AG Grid tables, evaluation and a new policy version", async ({ page }) => {
  await page.goto("/");
  await as(page, "Admin");
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("Held in PayPal escrow, all time")).toBeVisible();
  await expect(page.getByRole("img", { name: /Daily funding/ })).toBeVisible();
  await expect(page.locator(".ag-row").first()).toBeVisible(); // seeded history fills the grid
  await shot(page, "30-admin-overview");

  await page.goto("/admin/risk");
  await expect(page.getByText("Waiting for you").first()).toBeVisible();
  await page.getByLabel("Search the table").fill("HOLD");
  await expect(page.locator(".ag-row").first()).toBeVisible();
  await shot(page, "31-admin-review-queue");

  await page.goto("/admin/ledger");
  await expect(page.getByText("All ledger invariants hold")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  expect((await download).suggestedFilename()).toBe("settleai-ledger.csv");

  await page.goto("/admin/disputes");
  await expect(page.locator(".ag-row").first()).toBeVisible();
  await shot(page, "32-admin-disputes");

  await page.goto("/admin/eval");
  await expect(page.getByText("Bad proofs paid automatically")).toBeVisible();
  await shot(page, "33-admin-eval");

  await page.goto("/admin/policy");
  await page.getByLabel("Send to a person at risk score").fill("20");
  await page.getByLabel("Why are you changing it?").fill("Stricter review during launch week");
  await page.getByRole("button", { name: "Save as a new version" }).click();
  await expect(page.getByText(/Version 2 is active/)).toBeVisible();
  await expect(page.getByText("reviewAt: 25 -> 20")).toBeVisible();
  await shot(page, "34-admin-policy");
});
