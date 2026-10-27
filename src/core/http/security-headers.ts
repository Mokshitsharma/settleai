// Security headers applied to every response by next.config.ts (and checked by tests/security/limits-and-headers.test.ts).
// Next.js injects inline bootstrap scripts, so script-src keeps 'unsafe-inline'; 'unsafe-eval' only in development.
export function securityHeaders(env: string | undefined = process.env.NODE_ENV): { key: string; value: string }[] {
  const dev = env !== "production";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  const headers = [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=(), payment=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];
  if (!dev) headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" });
  return headers;
}

/** Non-financial, public, identical-for-every-user API reads that browsers and CDNs may cache. Nothing else. */
export const CACHEABLE_API_ROUTES = ["/api/keys/platform"] as const;

/**
 * Cache rules for next.config headers(). Order matters: Next.js lets a later matching rule override the same
 * header key. Every API response defaults to no-store, so balances, escrow, payouts, jobs and receipts are never
 * cached by a browser, proxy or CDN; only the allowlisted public reads above get a short max-age.
 */
export function cacheRules(): { source: string; headers: { key: string; value: string }[] }[] {
  return [
    { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ...CACHEABLE_API_ROUTES.map((source) => ({ source, headers: [{ key: "Cache-Control", value: "public, max-age=300, stale-while-revalidate=60" }] })),
  ];
}
