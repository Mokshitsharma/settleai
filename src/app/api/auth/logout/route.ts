import { clearSession } from "@/core/auth/session";
import { handle } from "../../_lib";

export const POST = handle(async () => {
  await clearSession();
  return Response.json({ ok: true });
});
