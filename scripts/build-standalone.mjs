// pnpm build:standalone — after `pnpm build` and `pnpm db:template`, assembles .next/standalone so production needs only
// plain node: no pnpm, corepack or tsx at runtime. Compiles the boot script and copies what the server reads from disk
// (next start would keep the build toolchain around; this is what fits a 512 MB instance).
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const out = ".next/standalone";
if (!existsSync(`${out}/server.js`)) throw new Error("Run pnpm build first (next.config.ts sets output: standalone)");

await build({
  entryPoints: ["scripts/db.ts"],
  outfile: `${out}/db-boot.cjs`,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  alias: { "@": path.resolve("src") },
  // Native or WASM packages stay real files; the standalone output traces them for the server too.
  external: ["@electric-sql/pglite", "sharp", "exifr", "pg-native"],
  logLevel: "warning",
});

async function copy(from, to = from) {
  if (!existsSync(from)) return;
  await mkdir(path.dirname(`${out}/${to}`), { recursive: true });
  await cp(from, `${out}/${to}`, { recursive: true, force: true });
}

// Tracing misses sharp's native libraries, which live in optional platform packages. Copy them as real files.
for (const dir of await readdir("node_modules/.pnpm")) {
  if (!/^(sharp@|@img\+)/.test(dir)) continue;
  const target = `${out}/node_modules/.pnpm/${dir}`;
  await rm(target, { recursive: true, force: true });
  await cp(`node_modules/.pnpm/${dir}`, target, { recursive: true, dereference: true, force: true });
}

// Assets Next.js expects to be served from next to server.js.
await copy(".next/static");
await copy("public");
// Files the app reads at runtime, relative to its working directory.
await copy("src/core/db/migrations");
await copy("eval/report.json");
await copy("assets/demo-photos");
// The pristine demo database and everything it refers to, built at deploy time and restored on every boot.
const dataDir = process.env.PGLITE_DATA_DIR ?? ".data/pglite";
if (!existsSync(`${dataDir}-template`)) throw new Error(`Run pnpm db:template first: ${dataDir}-template is missing`);
await rm(`${out}/.data`, { recursive: true, force: true });
await copy(`${dataDir}-template`);
await copy(".data/uploads");
await copy(".data/platform-key.json");
await copy(process.env.PROCUREBOT_KEY_FILE ?? ".data/procurebot-key");
console.log(`Standalone server assembled in ${out}.`);
