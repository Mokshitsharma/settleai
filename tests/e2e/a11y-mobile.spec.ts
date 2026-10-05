import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { as, fundedAcceptedJob, shot } from "./helpers";

/** WCAG 2.1 AA rules; serious and critical findings fail the test (spec §13.3 accessibility). */
async function audit(page: Page, name: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${name}: ${v.id} (${v.nodes.length}) ${v.help} -> ${v.nodes[0]?.target.join(" ")}`)).toEqual([]);
}

test("accessibility: key pages have no serious or critical WCAG AA violations", async ({ page }) => {
  await page.goto("/");
  await audit(page, "landing");
  const url = await fundedAcceptedJob(page);
  await audit(page, "job (worker)");
  await page.getByRole("link", { name: "Submit proof" }).click();
  await audit(page, "proof submission");
  await as(page, "Payer");
  await page.goto("/mandates");
  await audit(page, "mandates");
  await page.goto("/new");
  await audit(page, "new job");
  await page.goto(url);
  await audit(page, "job (payer)");
  await page.goto("/verify");
  await audit(page, "verify");
  await as(page, "Admin");
  await page.goto("/admin");
  await audit(page, "admin overview");
});

test.describe("phone-sized screen", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("worker can accept and submit proof on a phone without horizontal scrolling", async ({ page }) => {
    await page.goto("/");
    await shot(page, "40-mobile-landing");
    const url = await fundedAcceptedJob(page);
    await shot(page, "41-mobile-job");
    await page.getByRole("link", { name: "Submit proof" }).click();
    await expect(page.getByRole("button", { name: "Submit for verification" })).toBeVisible();
    await shot(page, "42-mobile-submit");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.goto(url);
    const jobOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(jobOverflow).toBeLessThanOrEqual(1);
  });
});
