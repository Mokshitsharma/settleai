import { eq } from "drizzle-orm";
import { z } from "zod";
import { getContainer } from "@/core/container";
import { apiClients } from "@/core/db/schema";
import { HttpError, handle, readJson, requireUser } from "../../../_lib";

/** Admin suspends or re-enables an agent client (an audited action; suspended keys are refused at once). */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/admin/agents/[id]">) => {
  const user = await requireUser(["admin"]);
  const { id } = await ctx.params;
  const { status } = await readJson(req, z.object({ status: z.enum(["active", "suspended"]) }));
  const c = await getContainer();
  const updated = await c.dbHandle.db.update(apiClients).set({ status, updatedAt: new Date() }).where(eq(apiClients.id, id)).returning({ id: apiClients.id });
  if (!updated.length) throw new HttpError(404, "NOT_FOUND", "Agent not found");
  await c.audit.append({ actor: `admin:${user.id}`, action: `agent.${status}`, entityType: "api_client", entityId: id, payload: { status } });
  c.events.publish("admin", "agent.status", `Agent ${id} is now ${status}`);
  return Response.json({ ok: true, status });
});
