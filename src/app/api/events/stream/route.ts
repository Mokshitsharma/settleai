import { getContainer } from "@/core/container";
import { HttpError, handle, requireUser } from "../../_lib";

export const dynamic = "force-dynamic";

/** SSE: live agent and domain events for one job (parties and admin) or the admin firehose. */
export const GET = handle(async (req: Request) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const jobId = url.searchParams.get("jobId");
  const c = await getContainer();
  let channel = "admin";
  if (jobId) {
    const job = await c.jobs.getRow(jobId);
    if (!job) throw new HttpError(404, "NOT_FOUND", "Job not found");
    const party = user.role === "admin" || job.payerId === user.id || job.workerId === user.id || (user.role === "worker" && job.status === "FUNDED");
    if (!party) throw new HttpError(403, "FORBIDDEN", "Not your job");
    channel = `job:${jobId}`;
  } else if (user.role !== "admin") {
    throw new HttpError(403, "FORBIDDEN", "The firehose is admin only");
  }

  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          unsubscribe();
        }
      };
      unsubscribe = c.events.subscribe(channel, (e) => send(`id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
      heartbeat = setInterval(() => send(": ping\n\n"), 15_000);
      req.signal.addEventListener("abort", () => {
        unsubscribe();
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      unsubscribe();
      clearInterval(heartbeat);
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive" },
  });
});
