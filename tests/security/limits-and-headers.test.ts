// Image size/dimension limits (decompression-bomb guard) and the security headers sent on every response.
import { crc32, deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { assertImageLimits, ImageLimitError, ingestImage, MAX_IMAGE_BYTES } from "@/core/checks/image";
import { securityHeaders } from "@/core/http/security-headers";
import nextConfig from "../../next.config";

/** A valid PNG whose header claims width x height but whose pixel data is a single tiny IDAT. */
function pngHeaderOnly(width: number, height: number): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 0, 0, 0, 0], 8); // 8-bit greyscale
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new Uint8Array(Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.alloc(1))), chunk("IEND", Buffer.alloc(0))]));
}

describe("image limits", () => {
  it("accepts a normal photo and reports its size", async () => {
    const img = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#888" } }).jpeg().toBuffer();
    await expect(assertImageLimits(new Uint8Array(img))).resolves.toEqual({ width: 64, height: 48 });
  });
  it("rejects empty and oversized byte arrays before decoding", async () => {
    await expect(assertImageLimits(new Uint8Array(0))).rejects.toBeInstanceOf(ImageLimitError);
    await expect(assertImageLimits(new Uint8Array(MAX_IMAGE_BYTES + 1))).rejects.toBeInstanceOf(ImageLimitError);
  });
  it("rejects tiny images", async () => {
    await expect(assertImageLimits(pngHeaderOnly(8, 8))).rejects.toBeInstanceOf(ImageLimitError);
  });
  it("rejects an over-long side", async () => {
    await expect(assertImageLimits(pngHeaderOnly(20_000, 100))).rejects.toThrow();
  });
  it("rejects a pixel bomb (small file claiming 11k x 11k = 121 MP) without decoding it", async () => {
    const bomb = pngHeaderOnly(11_000, 11_000);
    expect(bomb.byteLength).toBeLessThan(200);
    await expect(assertImageLimits(bomb)).rejects.toThrow();
    await expect(ingestImage(bomb)).rejects.toThrow();
  });
  it("rejects bytes that are not an image", async () => {
    await expect(assertImageLimits(new TextEncoder().encode("<svg onload=alert(1)>"))).rejects.toThrow();
  });
});

describe("security headers", () => {
  const map = (env: string) => Object.fromEntries(securityHeaders(env).map((h) => [h.key, h.value]));
  it("production sends CSP without unsafe-eval, HSTS, nosniff, DENY framing", () => {
    const h = map("production");
    expect(h["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(h["Content-Security-Policy"]).toContain("object-src 'none'");
    expect(h["Content-Security-Policy"]).not.toContain("unsafe-eval");
    expect(h["Strict-Transport-Security"]).toMatch(/max-age=\d{8,}/);
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  });
  it("development allows eval for hot reload and skips HSTS", () => {
    const h = map("development");
    expect(h["Content-Security-Policy"]).toContain("unsafe-eval");
    expect(h["Strict-Transport-Security"]).toBeUndefined();
  });
  it("next.config applies the headers to every path and hides X-Powered-By", async () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    const rules = await nextConfig.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe("/:path*");
    expect(rules[0].headers.map((h) => h.key)).toContain("Content-Security-Policy");
  });
});
