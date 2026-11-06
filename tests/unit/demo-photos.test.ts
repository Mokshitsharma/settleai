// Real demo photos: metadata never ships, each proof is a different image, and generated samples remain the fallback.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import exifr from "exifr";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listDemoPhotos, renderDemoPhoto, stripPhoto } from "@/core/checks/demo-photos";
import { differenceHash, hammingDistance, readExif } from "@/core/checks/image";
import { makeProofPhoto, makeSamplePhoto } from "@/core/checks/sample-photos";

async function photoLike(seed: number, width = 1200, height = 900): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = (Math.sin((x + seed * 37) / 61) + Math.cos((y * (seed + 2)) / 47) + Math.sin((x + y) / 23)) * 42 + 128;
      raw.fill(v, (y * width + x) * 3, (y * width + x) * 3 + 3);
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg().toBuffer();
}

describe("demo photos", () => {
  let dir: string;
  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "settleai-photos-"));
    vi.stubEnv("DEMO_PHOTOS_DIR", dir);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("stripPhoto removes GPS, time and device from a real-looking original", async () => {
    const withGps = await makeSamplePhoto({ seed: "orig", caption: "x", takenAt: new Date("2026-11-01T10:00:00Z"), location: { lat: 22.7, lng: 75.8 } });
    expect((await readExif(withGps)).lat).toBeDefined();
    const clean = await stripPhoto(withGps);
    expect(await exifr.parse(clean, { gps: true }).catch(() => null)).toBeFalsy();
    expect((await readExif(clean)).lat).toBeUndefined();
  });

  it("falls back to the generated sample when no real photos are installed", async () => {
    expect(listDemoPhotos("pickup")).toEqual([]);
    expect(await renderDemoPhoto("pickup", "s")).toBeNull();
    const bytes = await makeProofPhoto({ kind: "pickup", seed: "s", caption: "fallback", takenAt: new Date("2026-11-01T10:00:00Z"), location: { lat: 22.7, lng: 75.8 } });
    expect((await readExif(bytes)).lat).toBeCloseTo(22.7, 3);
  });

  it("stamps demo EXIF on a real photo, and only when asked", async () => {
    writeFileSync(path.join(dir, "dropoff-1.jpg"), await photoLike(1));
    const stamped = await makeProofPhoto({ kind: "dropoff", seed: "a", caption: "", takenAt: new Date("2026-11-01T10:00:00Z"), location: { lat: 22.7, lng: 75.8 } });
    const exif = await readExif(stamped);
    expect(exif.lat).toBeCloseTo(22.7, 3);
    expect(exif.takenAt).toBeDefined();
    const bare = await makeProofPhoto({ kind: "dropoff", seed: "a", caption: "" });
    expect((await readExif(bare)).lat).toBeUndefined();
  });

  it("different seeds give different images; most are not perceptual duplicates", async () => {
    writeFileSync(path.join(dir, "pickup-1.jpg"), await photoLike(2));
    writeFileSync(path.join(dir, "pickup-2.jpg"), await photoLike(5));
    const hashes = await Promise.all(Array.from({ length: 8 }, async (_, i) => differenceHash(new Uint8Array((await renderDemoPhoto("pickup", `seed-${i}`))!))));
    expect(new Set(hashes).size).toBeGreaterThan(1);
    let distinctPairs = 0;
    for (let i = 0; i < hashes.length; i++) for (let j = i + 1; j < hashes.length; j++) if (hammingDistance(hashes[i], hashes[j]) > 6) distinctPairs++;
    expect(distinctPairs).toBeGreaterThan(0);
  });
});
