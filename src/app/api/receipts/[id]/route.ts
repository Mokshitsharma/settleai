import { getContainer } from "@/core/container";
import { SHOWCASE_ID, showcaseRaw } from "@/core/receipts/showcase";
import { HttpError, handle } from "../../_lib";

export const dynamic = "force-dynamic";

/** Public, downloadable receipt bundle for offline verification (no personal data inside). */
export const GET = handle(async (req: Request, ctx: RouteContext<"/api/receipts/[id]">) => {
  const { id } = await ctx.params;
  const download = new URL(req.url).searchParams.has("download");
  if (id === SHOWCASE_ID) {
    const raw = await showcaseRaw();
    if (!raw) throw new HttpError(404, "NOT_FOUND", "The showcase receipt is not installed");
    return new Response(raw, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        ...(download ? { "content-disposition": `attachment; filename="settleai-receipt-showcase.json"` } : {}),
      },
    });
  }
  const c = await getContainer();
  const bundle = await c.receipts.build(id);
  if (!bundle) throw new HttpError(404, "NOT_FOUND", "No receipt: the job does not exist or has not been funded, or the demo has reset since; a downloaded receipt still verifies offline");
  return new Response(JSON.stringify(bundle, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(download ? { "content-disposition": `attachment; filename="settleai-receipt-${id}.json"` } : {}),
    },
  });
});
