import { z } from "zod";
import { getContainer } from "@/core/container";
import { handle, readJson, requireUser } from "../../_lib";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  await requireUser(["admin"]);
  const c = await getContainer();
  return Response.json({ active: await c.policy.active(), history: await c.policy.history() });
});

/** Saves a new policy version (validated; audit-logged with the list of changes). The next decision uses it. */
export const PUT = handle(async (req: Request) => {
  const user = await requireUser(["admin"]);
  const { policy, note } = await readJson(req, z.object({ policy: z.unknown(), note: z.string().trim().min(3).max(300) }));
  const c = await getContainer();
  const saved = await c.policy.save({ json: policy, adminId: user.id, note });
  c.events.publish("admin", "policy.updated", `Risk policy v${saved.version} is now active: ${note}`);
  return Response.json({ policy: saved });
});
