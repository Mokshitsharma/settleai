import { getContainer } from "@/core/container";
import { handle } from "../../_lib";

export const dynamic = "force-dynamic";

/** Published platform key ids (and public keys), so verifiers can pin the platform signature. */
export const GET = handle(async () => {
  const c = await getContainer();
  const keys = (await c.keys.listPublic()).filter((k) => k.ownerType === "platform");
  return Response.json({ keyIds: keys.map((k) => k.keyId), keys: keys.map(({ keyId, publicJwk, status, createdAt, retiredAt }) => ({ keyId, publicJwk, status, createdAt, retiredAt })) });
});
