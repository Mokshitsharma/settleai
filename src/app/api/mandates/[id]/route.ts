import { getContainer } from "@/core/container";
import { HttpError, handle, requireUser } from "../../_lib";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/mandates/[id]">) => {
  const user = await requireUser(["payer", "admin"]);
  const { id } = await ctx.params;
  const c = await getContainer();
  const mandate = await c.mandates.get(id);
  if (!mandate) throw new HttpError(404, "NOT_FOUND", "Mandate not found");
  const p = mandate.envelope.payload;
  if (user.role !== "admin" && p.type === "intent" && p.issuer.userId !== user.id) throw new HttpError(403, "FORBIDDEN", "Not your mandate");
  return Response.json({ mandate });
});
