import { z } from "zod";
import { getContainer } from "@/core/container";
import { handle, readJson, requireUser } from "../_lib";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const user = await requireUser(["payer", "admin"]);
  const c = await getContainer();
  return Response.json({ mandates: await c.mandates.listForIssuer(user.id) });
});

/**
 * Create an Intent Mandate from a signed draft. `jws` comes from the browser key; with
 * signing: "managed" the server signs with the user's encrypted demo key (labelled in the UI).
 */
export const POST = handle(async (req: Request) => {
  const user = await requireUser(["payer"]);
  const body = await readJson(
    req,
    z.union([
      z.object({ payload: z.unknown(), jws: z.string().min(10) }),
      z.object({ payload: z.unknown(), signing: z.literal("managed") }),
    ]),
  );
  const c = await getContainer();
  const jws =
    "jws" in body
      ? body.jws
      : await c.mandates.signWithManagedKey(user.id, body.payload as Parameters<typeof c.mandates.signWithManagedKey>[1]);
  const mandate = await c.mandates.createIntent({ userId: user.id, payload: body.payload, jws });
  c.events.publish("admin", "mandate.signed", `${user.name} signed a mandate for ${mandate.envelope.payload.type === "intent" ? mandate.envelope.payload.agent.name : "an agent"}`);
  return Response.json({ mandate }, { status: 201 });
});
