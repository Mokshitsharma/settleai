import type { NextConfig } from "next";
import { cacheRules, securityHeaders } from "./src/core/http/security-headers";

const nextConfig: NextConfig = {
  // A self-contained server started with plain node, small enough for a 512 MB instance.
  output: "standalone",
  // PGlite ships WASM and data files that must be loaded from node_modules, not bundled. exifr tries to require fs and
  // zlib at load, and warns when bundled; as a real package it finds them.
  serverExternalPackages: ["@electric-sql/pglite", "exifr"],
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders() }, ...cacheRules()];
  },
};

export default nextConfig;
