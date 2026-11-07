// The committed showcase receipt: it verifies against the published key, a one-byte change fails it, and it is real.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SHOWCASE_ID, showcaseBundle, showcaseRaw } from "@/core/receipts/showcase";
import { verifyReceipt } from "@/core/verifier/receipt";

const published = JSON.parse(readFileSync("docs/platform-public-key.json", "utf8")) as { keyIds: string[] };

describe("showcase receipt", () => {
  it("is served byte for byte from the committed file", async () => {
    expect(SHOWCASE_ID).toBe("showcase");
    expect(await showcaseRaw()).toBe(readFileSync("assets/showcase/receipt.json", "utf8"));
  });

  it("verifies offline against the published platform key", async () => {
    const result = await verifyReceipt((await showcaseBundle())!, { trustedPlatformKeyIds: published.keyIds });
    expect(result.ok).toBe(true);
  });

  it("fails against any other key list, so the signature really is pinned", async () => {
    const result = await verifyReceipt((await showcaseBundle())!, { trustedPlatformKeyIds: ["key_someone_else"] });
    expect(result.ok).toBe(false);
  });

  it("a one-byte change fails verification", async () => {
    const raw = (await showcaseRaw())!;
    const at = raw.indexOf('"amountMinor": ') + '"amountMinor": '.length;
    const digit = raw[at];
    const tampered = raw.slice(0, at) + (digit === "9" ? "8" : String(Number(digit) + 1)) + raw.slice(at + 1);
    const result = await verifyReceipt(JSON.parse(tampered), { trustedPlatformKeyIds: published.keyIds });
    expect(result.ok).toBe(false);
  });

  it("records real money movement, not mock ids, and holds no personal data", async () => {
    const raw = (await showcaseRaw())!;
    expect(raw).not.toContain("MOCK-");
    expect(raw).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    const bundle = (await showcaseBundle())!;
    expect(bundle.ledger.fundedMinor).toBe(bundle.job.totalMinor + bundle.job.feeMinor);
    expect(bundle.ledger.releasedMinor).toBeGreaterThan(0);
    expect(bundle.fees.paypalChargedMinor).toBeGreaterThan(0);
  });
});
