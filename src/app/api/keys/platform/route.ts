import { readFile } from "node:fs/promises";
import path from "node:path";
import { getContainer } from "@/core/container";
import { handle } from "../../_lib";

export const dynamic = "force-dynamic";

/** Published platform key ids (and public keys), so verifiers can pin the platform signature. */
export const GET = handle(async () => {
  const c = await getContainer();
  const keys = (await c.keys.listPublic()).filter((k) => k.ownerType === "platform");
  // The published key signs the showcase, so it counts on any server, including local ones with their own dev key.
  const published = await readFile(path.resolve(/*turbopackIgnore: true*/ "docs/platform-public-key.json"), "utf8").then((t) => JSON.parse(t) as { keyIds: string[] }).catch(() => ({ keyIds: [] as string[] }));
  return Response.json({ keyIds: [...new Set([...keys.map((k) => k.keyId), ...published.keyIds])], keys: keys.map(({ keyId, publicJwk, status, createdAt, retiredAt }) => ({ keyId, publicJwk, status, createdAt, retiredAt })) });
});
