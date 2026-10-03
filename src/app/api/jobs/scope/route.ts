import { z } from "zod";
import { scopeJob } from "@/core/agents/scoping";
import { getContainer } from "@/core/container";
import { newId } from "@/core/ids";
import { handle, readJson, requireUser } from "../../_lib";

export const dynamic = "force-dynamic";

/**
 * Natural language -> JobSpec. Streams the agent's steps as Server-Sent Events, then a final
 * `result` event with the JobSpec (or a `fallback` event when the agent could not produce one).
 */
export const POST = handle(async (req: Request) => {
  const user = await requireUser(["payer"]);
  const { text } = await readJson(req, z.object({ text: z.string().trim().min(10).max(4000) }));
  const c = await getContainer();
  const draftId = newId("draft");
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        const result = await scopeJob(
          {
            db: c.dbHandle.db,
            llm: c.llm,
            emit: (type, message, data) => send("step", { type, message, data, at: new Date().toISOString() }),
          },
          { text, payerId: user.id, now: c.clock.now(), entityId: draftId },
        );
        if (result.ok) send("result", { spec: result.output, traceId: result.traceId, model: result.model });
        else send("fallback", { error: result.error, traceId: result.traceId });
      } catch (err) {
        send("fallback", { error: (err as Error).message });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive" },
  });
});
