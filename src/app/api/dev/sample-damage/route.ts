import { z } from "zod";
import { renderDemoPhoto } from "@/core/checks/demo-photos";
import { getContainer } from "@/core/container";
import { HttpError, handle, limit, readJson, requireUser } from "../../_lib";

/** Demo: attach a real photo of damaged goods to a dispute, for judges who have no picture of their own. */
export const POST = handle(async (req: Request) => {
  const user = await requireUser(["payer", "worker"]);
  limit(req, "write", user.id);
  const { disputeId } = await readJson(req, z.object({ disputeId: z.string() }));
  const photo = await renderDemoPhoto("damage", `${disputeId}-${Date.now()}`);
  if (!photo) throw new HttpError(404, "NO_SAMPLE", "No demo photo of damage is installed");
  const c = await getContainer();
  await c.disputes.addEvidence({ disputeId, userId: user.id, photo: new Uint8Array(photo) });
  return Response.json({ ok: true });
});
