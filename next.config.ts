import type { NextConfig } from "next";
import { securityHeaders } from "./src/core/http/security-headers";

const nextConfig: NextConfig = {
  // PGlite ships WASM and data files that must be loaded from node_modules, not bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders() }];
  },
};

export default nextConfig;
