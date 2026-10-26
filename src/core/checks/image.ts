// Image ingest (spec §8.4 step 1): SHA-256, perceptual hash, MIME sniffing, EXIF (time, GPS, device),
// dimensions, and a re-encoded copy for storage (re-encoding strips hidden payloads; EXIF is kept in the DB).
import exifr from "exifr";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { sha256Hex } from "@/core/mandates/canonical";

export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
/** Longest side and total pixels accepted before decoding (decompression-bomb guard). */
export const MAX_IMAGE_SIDE = 12_000;
export const MAX_IMAGE_PIXELS = 50_000_000;
export const MIN_IMAGE_SIDE = 16;

export class ImageLimitError extends Error {}

/** Reads only the image header and rejects files outside the size and dimension limits. */
export async function assertImageLimits(bytes: Uint8Array): Promise<{ width: number; height: number }> {
  if (bytes.byteLength === 0) throw new ImageLimitError("Image is empty");
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new ImageLimitError("Image is larger than 12 MB");
  const meta = await sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width < MIN_IMAGE_SIDE || height < MIN_IMAGE_SIDE) throw new ImageLimitError(`Image is too small (${width}x${height})`);
  if (width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE) throw new ImageLimitError(`Image side exceeds ${MAX_IMAGE_SIDE} px (${width}x${height})`);
  if (width * height > MAX_IMAGE_PIXELS) throw new ImageLimitError(`Image exceeds ${MAX_IMAGE_PIXELS / 1e6} megapixels`);
  return { width, height };
}

export interface ExifInfo {
  takenAt?: string; // ISO with offset
  takenAtHasOffset: boolean;
  lat?: number;
  lng?: number;
  device?: string;
  description?: string; // untrusted text; scanned for injection
}

export interface IngestedImage {
  sha256: string;
  phash: string; // 64-bit difference hash, 16 hex chars
  sniffedMime: string | null;
  width: number;
  height: number;
  exif: ExifInfo;
  stored: Uint8Array; // re-encoded JPEG for storage
}

/**
 * 64-bit difference hash (dHash): grayscale 9x8, compare adjacent pixels. Near-identical images (re-saved,
 * resized, recompressed) land within a few bits of each other. Not a security primitive.
 */
export async function differenceHash(bytes: Uint8Array): Promise<string> {
  const { data } = await sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS }).rotate().grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits = (bits << 1n) | (data[y * 9 + x] > data[y * 9 + x + 1] ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, "0");
}

export function hammingDistance(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}


/** EXIF "YYYY:MM:DD HH:MM:SS" + optional "+05:30" -> ISO. Without an offset we use the provided fallback. */
export function exifTimeToIso(raw: string, offset: string | undefined, fallbackOffset: string): { iso?: string; hasOffset: boolean } {
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(raw);
  if (!m) return { hasOffset: false };
  const off = offset && /^[+-]\d{2}:\d{2}$/.test(offset) ? offset : fallbackOffset;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${off === "Z" ? "Z" : off}`;
  return Number.isNaN(Date.parse(iso)) ? { hasOffset: false } : { iso: new Date(iso).toISOString(), hasOffset: Boolean(offset) };
}

export async function readExif(bytes: Uint8Array, fallbackOffset = "Z"): Promise<ExifInfo> {
  try {
    const tags = (await exifr.parse(Buffer.from(bytes), { gps: true, reviveValues: false, tiff: true, exif: true })) as
      | Record<string, unknown>
      | undefined;
    if (!tags) return { takenAtHasOffset: false };
    const rawTime = (tags.DateTimeOriginal ?? tags.CreateDate) as string | undefined;
    const time = rawTime ? exifTimeToIso(String(rawTime), tags.OffsetTimeOriginal as string | undefined, fallbackOffset) : { hasOffset: false };
    const lat = typeof tags.latitude === "number" ? tags.latitude : undefined;
    const lng = typeof tags.longitude === "number" ? tags.longitude : undefined;
    const device = [tags.Make, tags.Model].filter(Boolean).join(" ") || undefined;
    const description = typeof tags.ImageDescription === "string" ? tags.ImageDescription.slice(0, 500) : undefined;
    return { takenAt: time.iso, takenAtHasOffset: time.hasOffset, lat, lng, device, description };
  } catch {
    return { takenAtHasOffset: false };
  }
}

export async function ingestImage(bytes: Uint8Array, opts: { fallbackOffset?: string } = {}): Promise<IngestedImage> {
  await assertImageLimits(bytes);
  const type = await fileTypeFromBuffer(bytes);
  const exif = await readExif(bytes, opts.fallbackOffset);
  const img = sharp(bytes, { failOn: "error", limitInputPixels: MAX_IMAGE_PIXELS }).rotate();
  const meta = await img.metadata();
  const stored = new Uint8Array(await img.resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer());
  return {
    sha256: sha256Hex(bytes),
    phash: await differenceHash(bytes),
    sniffedMime: type?.mime ?? null,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    exif,
    stored,
  };
}

/** Downscaled JPEG for the vision model (spec §8.1: images downscaled to control latency and cost). */
export async function forModel(bytes: Uint8Array, maxSide = 1024): Promise<string> {
  const out = await sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS }).rotate().resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  return out.toString("base64");
}

/** Fallback EXIF offset when a camera did not record one: India for coordinates in India, else UTC. */
export function fallbackOffsetFor(location?: { lat: number; lng: number }): string {
  if (location && location.lat > 6 && location.lat < 37 && location.lng > 68 && location.lng < 98) return "+05:30";
  return "Z";
}

