// Sample proof photos with real EXIF (capture time, GPS, device) for tests and the judge demo.
// Each seed renders a visually distinct scene so different seeds never look like duplicates,
// while the same seed reproduces the same picture (the "reused photo" fraud case).
import piexif from "piexifjs";
import sharp from "sharp";

export interface SamplePhotoOptions {
  seed: string;
  caption: string;
  takenAt?: Date; // omit for "no EXIF"
  location?: { lat: number; lng: number };
  timeZoneOffsetMinutes?: number; // camera local time offset, default IST (+330)
  injectionText?: string; // printed on the image and stored in ImageDescription
}

function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
}

function toDms(value: number): [number, number][] {
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = Math.round((minFloat - min) * 60 * 10000);
  return [
    [deg, 1],
    [min, 1],
    [sec, 10000],
  ];
}

function exifLocalTime(d: Date, offsetMinutes: number): string {
  const local = new Date(d.getTime() + offsetMinutes * 60_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${local.getUTCFullYear()}:${p(local.getUTCMonth() + 1)}:${p(local.getUTCDate())} ${p(local.getUTCHours())}:${p(local.getUTCMinutes())}:${p(local.getUTCSeconds())}`;
}

/** Renders a 1200x900 "photo" of stacked cartons on a seeded background, then writes EXIF. */
export async function makeSamplePhoto(o: SamplePhotoOptions): Promise<Uint8Array> {
  const r = rng(o.seed);
  const hue = Math.floor(r() * 360);
  const blocks: string[] = [];
  // Large, seed-dependent structure dominates the 9x8 perceptual hash, so seeds differ clearly.
  for (let i = 0; i < 7; i++) {
    const x = Math.floor(r() * 1000);
    const y = Math.floor(r() * 700);
    const w = 150 + Math.floor(r() * 450);
    const h = 120 + Math.floor(r() * 380);
    const l = 20 + Math.floor(r() * 60);
    blocks.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="hsl(${(hue + i * 47) % 360},45%,${l}%)" opacity="0.9"/>`);
  }
  const cartons = Array.from({ length: 20 }, (_, i) => {
    const cx = 330 + (i % 5) * 110;
    const cy = 380 + Math.floor(i / 5) * 90;
    return `<rect x="${cx}" y="${cy}" width="100" height="80" rx="4" fill="#b98a55" stroke="#6d4c2a" stroke-width="4"/><line x1="${cx}" y1="${cy + 40}" x2="${cx + 100}" y2="${cy + 40}" stroke="#e8d3a8" stroke-width="6"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900">
    <rect width="1200" height="900" fill="hsl(${hue},30%,82%)"/>${blocks.join("")}${cartons}
    <rect x="0" y="820" width="1200" height="80" fill="rgba(0,0,0,0.55)"/>
    <text x="30" y="872" font-family="Arial" font-size="38" fill="#fff">${escapeXml(o.caption)}</text>
    ${o.injectionText ? `<text x="30" y="80" font-family="Arial" font-size="34" fill="#c00">${escapeXml(o.injectionText)}</text>` : ""}
  </svg>`;
  const jpeg = await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
  if (!o.takenAt && !o.location && !o.injectionText) return new Uint8Array(jpeg);

  const zeroth: Record<number, unknown> = { [piexif.ImageIFD.Make]: "SettleAI", [piexif.ImageIFD.Model]: "Demo Camera" };
  if (o.injectionText) zeroth[piexif.ImageIFD.ImageDescription] = o.injectionText;
  const exif: Record<number, unknown> = {};
  if (o.takenAt) exif[piexif.ExifIFD.DateTimeOriginal] = exifLocalTime(o.takenAt, o.timeZoneOffsetMinutes ?? 330);
  const gps: Record<number, unknown> = {};
  if (o.location) {
    gps[piexif.GPSIFD.GPSLatitudeRef] = o.location.lat >= 0 ? "N" : "S";
    gps[piexif.GPSIFD.GPSLatitude] = toDms(o.location.lat);
    gps[piexif.GPSIFD.GPSLongitudeRef] = o.location.lng >= 0 ? "E" : "W";
    gps[piexif.GPSIFD.GPSLongitude] = toDms(o.location.lng);
  }
  const bytes = piexif.dump({ "0th": zeroth, Exif: exif, GPS: gps } as piexif.ExifDict);
  const withExif = piexif.insert(bytes, jpeg.toString("binary"));
  return new Uint8Array(Buffer.from(withExif, "binary"));
}

/** Moves a point roughly `meters` north-east, for "wrong place" samples. */
export function offsetPoint(p: { lat: number; lng: number }, meters: number) {
  const d = meters / Math.SQRT2;
  return { lat: p.lat + d / 111_320, lng: p.lng + d / (111_320 * Math.cos((p.lat * Math.PI) / 180)) };
}
