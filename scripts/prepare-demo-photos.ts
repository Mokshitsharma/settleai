// pnpm photos:prepare — copies demo-photos/* (originals, git-ignored) to assets/demo-photos/ with all metadata removed.
// Name originals pickup-*, dropoff-* or damage-*. Look at the output before committing it.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import exifr from "exifr";
import { stripPhoto } from "@/core/checks/demo-photos";

async function main() {
  const out = "assets/demo-photos";
  mkdirSync(out, { recursive: true });
  const files = readdirSync("demo-photos").filter((f) => /\.(jpe?g|png|webp|heic|heif)$/i.test(f));
  const counts = { pickup: 0, dropoff: 0, damage: 0 };
  for (const f of files) {
    const kind = (Object.keys(counts) as (keyof typeof counts)[]).find((k) => f.toLowerCase().startsWith(k));
    if (!kind) {
      console.log(`Skipped ${f}: the name must start with pickup, dropoff or damage`);
      continue;
    }
    counts[kind]++;
    const clean = await stripPhoto(readFileSync(path.join("demo-photos", f)));
    const left = await exifr.parse(clean, { gps: true }).catch(() => null);
    if (left && Object.keys(left).length) throw new Error(`${f}: metadata survived; not writing it`);
    writeFileSync(path.join(out, `${kind}-${counts[kind]}.jpg`), clean);
  }
  console.log(`Prepared ${JSON.stringify(counts)} in ${out}, with no EXIF or GPS.`);
  for (const [k, n] of Object.entries(counts)) if (n === 0) console.log(`Warning: no ${k} photos`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
