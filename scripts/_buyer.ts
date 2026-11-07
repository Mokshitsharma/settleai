// Approves a PayPal sandbox order as the sandbox buyer, in a real checkout. Sandbox credentials come from the caller.
import { chromium } from "@playwright/test";

export async function buyerApproves(approveUrl: string, returnBase: string, email: string, password: string): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    const returned = page.waitForRequest((r) => r.url().startsWith(returnBase), { timeout: 150_000 });
    await page.goto(approveUrl, { waitUntil: "domcontentloaded" });
    await page.locator("#email").fill(email, { timeout: 60_000 });
    if (await page.locator("#btnNext").isVisible()) await page.locator("#btnNext").click();
    await page.locator("#password").fill(password, { timeout: 60_000 });
    await page.locator("#btnLogin").click();
    await page.locator('#payment-submit-btn, [data-testid="submit-button-initial"]').first().click({ timeout: 90_000 });
    await returned;
  } catch (err) {
    await page.screenshot({ path: ".data/checkout-failure.png" }).catch(() => {});
    throw new Error(`Sandbox checkout did not complete at ${new URL(page.url()).pathname}: ${(err as Error).message.split("\n")[0]}`);
  } finally {
    await browser.close();
  }
}
