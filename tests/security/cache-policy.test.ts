// Caching policy: only non-financial public reads may be cached. Every money path (funding, payouts, ledger,
// escrow, disputes, receipts, webhooks) must answer with Cache-Control: no-store.
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { CACHEABLE_API_ROUTES } from "@/core/http/security-headers";

const API_DIR = path.resolve("src/app/api");
function routeFiles(dir = API_DIR): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? routeFiles(p) : f === "route.ts" ? [p] : [];
  });
}
const routes = routeFiles().map((f) => "/api/" + path.relative(API_DIR, path.dirname(f)).split(path.sep).join("/").replace(/\[id\]/g, "abc123"));

/** Minimal Next.js `source` matcher for the patterns used in next.config (exact paths and /:path*). */
function matches(source: string, p: string): boolean {
  if (source.endsWith("/:path*")) {
    const base = source.slice(0, -"/:path*".length);
    return p === base || p.startsWith(base + "/");
  }
  return source === p;
}

async function effectiveCacheControl(p: string): Promise<string | undefined> {
  let value: string | undefined;
  for (const rule of await nextConfig.headers!()) {
    if (!matches(rule.source, p)) continue;
    for (const h of rule.headers) if (h.key.toLowerCase() === "cache-control") value = h.value; // later rules win
  }
  return value;
}

describe("cache policy", () => {
  it("found the API routes", () => expect(routes.length).toBeGreaterThan(30));

  it("every money-related API route is no-store", async () => {
    const money = routes.filter((r) => /fund|capture|milestones|disputes|dispute-evidence|jobs|receipts|webhooks|mandates|admin|agent|verify|proofs/.test(r));
    expect(money.length).toBeGreaterThan(20);
    for (const r of money) expect(await effectiveCacheControl(r), r).toBe("no-store");
  });

  it("all API routes except the public-key allowlist are no-store", async () => {
    for (const r of routes) {
      const cc = await effectiveCacheControl(r);
      if ((CACHEABLE_API_ROUTES as readonly string[]).includes(r)) expect(cc).toMatch(/^public, max-age=\d+/);
      else expect(cc, r).toBe("no-store");
    }
  });

  it("the cache allowlist holds no money path", () => {
    for (const r of CACHEABLE_API_ROUTES) expect(r).not.toMatch(/fund|pay|ledger|escrow|release|refund|job|milestone|dispute|receipt|balance/);
  });
});
