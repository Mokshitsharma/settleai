import { getContainer } from "@/core/container";
import { MAX_IMAGE_BYTES } from "@/core/checks/image";
import { HttpError, handle, requireUser } from "../../../_lib";

/** Worker adds proof: multipart with any of `photo` (file), `text`, `lat`+`lng`(+`accuracy`). */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/milestones/[id]/proofs">) => {
  const user = await requireUser(["worker"]);
  const { id } = await ctx.params;
  const c = await getContainer();
  const form = await req.formData();
  const added: string[] = [];

  const photo = form.get("photo");
  if (photo instanceof File && photo.size > 0) {
    if (photo.size > MAX_IMAGE_BYTES) throw new HttpError(413, "TOO_LARGE", "Photos must be 12 MB or smaller");
    const p = await c.proofs.addPhoto({ milestoneId: id, workerId: user.id, bytes: new Uint8Array(await photo.arrayBuffer()), declaredMime: photo.type || "application/octet-stream" });
    added.push(p.id);
  }
  const text = form.get("text");
  if (typeof text === "string" && text.trim()) added.push((await c.proofs.addText({ milestoneId: id, workerId: user.id, text })).id);
  const lat = Number(form.get("lat"));
  const lng = Number(form.get("lng"));
  if (form.get("lat") !== null && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    const accuracy = Number(form.get("accuracy"));
    added.push((await c.proofs.addGeo({ milestoneId: id, workerId: user.id, lat, lng, accuracyM: Number.isFinite(accuracy) ? accuracy : undefined })).id);
  }
  if (!added.length) throw new HttpError(400, "EMPTY", "Attach a photo, a confirmation or your location");
  return Response.json({ added });
});
