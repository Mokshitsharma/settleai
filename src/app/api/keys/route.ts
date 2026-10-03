import { z } from "zod";
import { getContainer } from "@/core/container";
import { handle, readJson, requireUser } from "../_lib";

const PublicJwk = z.object({ kty: z.literal("EC"), crv: z.literal("P-256"), x: z.string(), y: z.string() });

/** Register this browser's public signing key (the private key never leaves the browser), or get a managed demo key. */
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const body = await readJson(req, z.union([z.object({ publicJwk: PublicJwk }), z.object({ mode: z.literal("managed") })]));
  const c = await getContainer();
  if ("mode" in body) {
    return Response.json({ keyId: await c.keys.ensureManagedKey("user", user.id), mode: "managed" });
  }
  return Response.json({ keyId: await c.keys.registerPublicKey("user", user.id, body.publicJwk), mode: "browser" });
});
