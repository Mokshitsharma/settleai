import { z } from "zod";
import { getContainer } from "@/core/container";
import { handle, readJson, requireUser } from "../_lib";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const user = await requireUser();
  const c = await getContainer();
  return Response.json({ jobs: await c.jobs.listFor(user) });
});

/** Create a job from a confirmed JobSpec (payer). Agent-created jobs go through MCP + Mandate Guard (T303). */
export const POST = handle(async (req: Request) => {
  const user = await requireUser(["payer"]);
  const { spec } = await readJson(req, z.object({ spec: z.unknown() }));
  const c = await getContainer();
  const job = await c.jobs.createFromSpec({ payerId: user.id, spec, createdBy: `user:${user.id}` });
  return Response.json({ job }, { status: 201 });
});
