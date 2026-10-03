import { z } from "zod";
import { getContainer } from "@/core/container";
import { handle, readJson, requireUser } from "../../../_lib";

/** Revoke immediately. Pausing dependent releases (PAUSED_MANDATE) is wired in T207. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/mandates/[id]/revoke">) => {
  const user = await requireUser(["payer", "admin"]);
  const { id } = await ctx.params;
  const { reason } = await readJson(req, z.object({ reason: z.string().trim().min(1).max(300).default("Revoked by principal") }));
  const c = await getContainer();
  const mandate = await c.mandates.revoke({ mandateId: id, actorUserId: user.id, actorRole: user.role, reason });
  c.events.publish("admin", "mandate.revoked", `Mandate ${id} revoked: ${reason}`);
  return Response.json({ mandate });
});
