// Illustrative demo images (AI-generated, disclosed) for the judge demo. Originals go in demo-photos/ (git-ignored); `pnpm photos:prepare` strips all
// their metadata into assets/demo-photos/, which is what ships. Name files pickup-*, dropoff-* or damage-*.
// Each demo proof is a different crop and flip of one of these images, stamped by the caller with demo EXIF and labelled
// a demo sample on the proof, because judges cannot stand at the job site with a phone.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

export type DemoPhotoKind = "pickup" | "dropoff" | "damage";

function photosDir(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.env.DEMO_PHOTOS_DIR ?? "assets/demo-photos");
}

export function listDemoPhotos(kind: DemoPhotoKind): string[] {
  const dir = photosDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().startsWith(kind) && f.toLowerCase().endsWith(".jpg"))
    .sort()
    .map((f) => path.join(dir, f));
}

/** Re-encodes pixels only: EXIF, GPS, device and every other metadata block are dropped. Upright, at most 1600 px. */
export async function stripPhoto(bytes: Uint8Array): Promise<Buffer> {
  return sharp(bytes).rotate().resize(1600, 1600, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
}

function hashSeed(seed: string): () => number {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/** A seeded crop and flip of a demo image of this kind, or null when none is installed. No metadata. */
export async function renderDemoPhoto(kind: DemoPhotoKind, seed: string): Promise<Buffer | null> {
  const files = listDemoPhotos(kind);
  if (!files.length) return null;
  const r = hashSeed(seed);
  const file = files[Math.floor(r() * files.length)];
  const meta = await sharp(file).metadata();
  const scale = 0.72 + r() * 0.2;
  const width = Math.max(16, Math.floor(meta.width * scale));
  const height = Math.max(16, Math.floor(meta.height * scale));
  const left = Math.floor(r() * (meta.width - width));
  const top = Math.floor(r() * (meta.height - height));
  const image = sharp(file).extract({ left, top, width, height });
  if (r() < 0.5) image.flop();
  return image.jpeg({ quality: 88 }).toBuffer();
}
