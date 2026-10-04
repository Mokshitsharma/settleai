import { getContainer } from "@/core/container";
import { MAX_IMAGE_BYTES } from "@/core/checks/image";
import { HttpError, handle, requireUser } from "../../../_lib";

/** Either party adds a statement and/or a photo while the evidence window is open (multipart form). */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/disputes/[id]/evidence">) => {
  const user = await requireUser(["payer", "worker"]);
  const { id } = await ctx.params;
  const form = await req.formData();
  const text = form.get("text");
  const photo = form.get("photo");
  if (photo instanceof File && photo.size > MAX_IMAGE_BYTES) throw new HttpError(413, "TOO_LARGE", "Photos must be 12 MB or smaller");
  const c = await getContainer();
  await c.disputes.addEvidence({
    disputeId: id,
    userId: user.id,
    text: typeof text === "string" ? text : undefined,
    photo: photo instanceof File && photo.size > 0 ? new Uint8Array(await photo.arrayBuffer()) : undefined,
  });
  return Response.json({ ok: true });
});
